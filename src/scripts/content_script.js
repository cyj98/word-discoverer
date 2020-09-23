import browser from 'webextension-polyfill';
import nlp from 'compromise';
import { makeHlStyle, addLexeme, readFile, processData } from './lib/common_lib';
import { getDictDefinitionUrl } from './lib/context_menu_lib';
// const pQueue = new PQueue({ concurrency: 1 });

const classNamePrefix = 'wdautohlen_';
const haveEnglishRegex = /[-a-zA-Z]/;
const beginWithEnglishRegex = /^[a-z][a-z]*$/;
let dictWords;
// let dictIdoms;

let wdMinimunRank = 1;
let wordMaxRank = 0;
let userVocabulary = [];
// let is_enabled = null;
let wdHlSettings = null;
let wdHoverSettings = null;
let wdOnlineDicts = null;
let wdEnableTTS = null;

// let disableByKeypress = false;

let currentLexeme = '';
// use to find node to render popup
let curWdNodeId = 1;

let functionKeyIsPressed = false;
let renderedNodeId = null;
let nodeToRenderId = null;

function limitTextLen(word) {
  if (!word) return word;
  // word = word.toLowerCase();
  const maxLen = 20;
  if (word.length <= maxLen) return word;
  return `${word.slice(0, maxLen)}...`;
}

function getHeatColorPoint(freqPercentOld) {
  let freqPercent = freqPercentOld;
  if (!freqPercent) freqPercent = 0;
  freqPercent = Math.max(0, Math.min(100, freqPercent));
  const hue = 100 - freqPercent;
  return `hsl(${hue}, 100%, 50%)`;
}

function assert(condition, message) {
  if (!condition) {
    throw message || 'Assertion failed';
  }
}

const goodTagsList = [
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'B',
  'SMALL',
  'STRONG',
  'Q',
  'DIV',
  'SPAN',
];

const mygoodfilter = (node) => {
  if (goodTagsList.indexOf(node.parentNode.tagName) !== -1) return NodeFilter.FILTER_ACCEPT;
  return NodeFilter.FILTER_SKIP;
};

function getRareLemma(word) {
  if (word.length < 3) return undefined;
  let lemma = word;
  if (!word.includes('-')) {
    const verbNlp = nlp(word).verbs();
    if (verbNlp.json().length !== 0) {
      lemma = verbNlp.toInfinitive().text();
    }
    const nounNlp = nlp(word).nouns();
    if (nounNlp.json().length !== 0) {
      lemma = nounNlp.toSingular().text();
    }
  }
  const wordFound = dictWords.find((obj) => obj.word === lemma);
  if (!wordFound || wordFound.rank < wdMinimunRank) return undefined;
  // const lemma = wordFound.word;
  return !userVocabulary || !Object.prototype.hasOwnProperty.call(userVocabulary, wordFound.word)
    ? wordFound
    : undefined;
}

async function textToHlNodes(text, dst) {
  const lcText = text.toLowerCase();
  // let wsText = lcText.replace(/[,;()?!`:"'.\s\-\u2013\u2014\u201C\u201D\u2019]/g, ' ');
  const wsText = lcText.replace(/[^\w- ']/g, ' ');
  // wsText = wsText.replace(/[^\w ]/g, '.');

  const tokens = wsText.split(' ');

  let numGood = 0; // number of found dictionary words
  let numNonempty = 0;
  let ibegin = 0; // beginning of word
  let wnum = 0; // word number

  const matches = [];

  const tokenizeOther = wdHoverSettings.ow_hover !== 'never';

  while (wnum < tokens.length) {
    if (tokens[wnum].length) {
      numNonempty += 1;
      let match;
      // if (!match && wdHlSettings.idiomParams.enabled) {
      //   let lwnum = wnum; // look ahead word number
      //   let libegin = ibegin; // look ahead word begin
      //   let mwePrefix = '';
      //   while (lwnum < tokens.length) {
      //     mwePrefix += tokens[lwnum];
      //     let wf;
      //     if (Object.prototype.hasOwnProperty.call(dictIdoms, mwePrefix)) {
      //       wf = dictIdoms[mwePrefix];
      //     }
      //     if (wf === -1 && (!libegin || text[libegin - 1] === ' ')) {
      //       // idiom prefix found
      //       mwePrefix += ' ';
      //       libegin += tokens[lwnum].length + 1;
      //       lwnum += 1;
      //     } else if (wf && wf !== -1 && (!libegin || text[libegin - 1] === ' ')) {
      //       // idiom found
      //       if (userVocabulary && Object.prototype.hasOwnProperty.call(userVocabulary, wf)) break;
      //       match = {
      //         normalized: wf,
      //         kind: 'idiom',
      //         begin: ibegin,
      //         end: ibegin + mwePrefix.length,
      //       };
      //       ibegin += mwePrefix.length + 1;
      //       numGood += lwnum - wnum + 1;
      //       wnum = lwnum + 1;
      //     } else {
      //       // idiom not found
      //       break;
      //     }
      //   }
      // }
      if (!match && wdHlSettings.wordParams.enabled) {
        const wordFound = getRareLemma(tokens[wnum]);
        if (wordFound && wordFound.word) {
          // console.log(tokens[wnum], wordFound.word);
          match = {
            normalized: wordFound.word,
            kind: 'lemma',
            begin: ibegin,
            end: ibegin + tokens[wnum].length,
            rank: wordFound.rank,
            frequency: wordFound.total,
          };
          ibegin += tokens[wnum].length + 1;
          wnum += 1;
          numGood += 1;
        }
      }
      if (
        tokenizeOther &&
        !match &&
        tokens[wnum].length >= 3 &&
        beginWithEnglishRegex.test(tokens[wnum])
      ) {
        match = {
          normalized: null,
          kind: 'word',
          begin: ibegin,
          end: ibegin + tokens[wnum].length,
        };
        ibegin += tokens[wnum].length + 1;
        wnum += 1;
      }
      if (Object.prototype.hasOwnProperty.call(dictWords, tokens[wnum])) {
        numGood += 1;
      }
      if (match) {
        matches.push(match);
      } else {
        ibegin += tokens[wnum].length + 1;
        wnum += 1;
      }
    } else {
      wnum += 1;
      ibegin += 1;
    }
  }

  if ((numGood * 1.0) / numNonempty < 0.1) {
    return 0;
  }

  let lastHlEndPos = 0;
  let insertCount = 0;
  for (let i = 0; i < matches.length; i += 1) {
    let textStyle;
    let className;
    const match = matches[i];
    if (match.kind === 'lemma') {
      const hlParams = wdHlSettings.wordParams;
      textStyle = makeHlStyle(hlParams);
      className = `${match.normalized}_${match.rank}:${match.frequency}`;
      // } else if (match.kind === 'idiom') {
      //   const hlParams = wdHlSettings.idiomParams;
      //   textStyle = makeHlStyle(hlParams);
    } else if (match.kind === 'word') {
      textStyle = 'font:inherit;display:inline;color:inherit;background-color:inherit;';
      className = match.normalized;
    }
    if (textStyle) {
      insertCount += 1;
      if (lastHlEndPos < match.begin) {
        dst.push(document.createTextNode(text.slice(lastHlEndPos, match.begin)));
      }
      lastHlEndPos = match.end;
      const span = document.createElement('span');
      span.textContent = text.slice(match.begin, lastHlEndPos);
      span.setAttribute('style', textStyle);
      span.id = `wdautohlen_id_${curWdNodeId}`;
      curWdNodeId += 1;
      // const wdclassname = makeClassName(match.normalized);
      const wdclassname = classNamePrefix + className;
      span.setAttribute('class', wdclassname);
      dst.push(span);
    }
  }

  if (insertCount && lastHlEndPos < text.length) {
    dst.push(document.createTextNode(text.slice(lastHlEndPos, text.length)));
  }

  return insertCount;
}

function doHighlightText(textNodes) {
  if (
    textNodes === null ||
    textNodes.length === 0 ||
    dictWords === null ||
    wdMinimunRank === null
  ) {
    return;
  }
  // if (disableByKeypress) {
  //   return;
  // }

  textNodes.forEach((textNode) => {
    const { parentNode } = textNode;
    if (!parentNode) {
      return;
    }
    if (textNodes.offsetParent === null) {
      return;
    }
    const text = textNode.textContent;
    if (text.length <= 3) {
      return;
    }
    if (text.indexOf('{') !== -1 && text.indexOf('}') !== -1) {
      // continue; //pathetic hack to skip json data in text (e.g. google images use it).
      return;
    }
    if (!text.match(haveEnglishRegex)) {
      return;
    }
    const newChildren = [];
    textToHlNodes(text, newChildren).then((insertCount) => {
      if (insertCount) {
        assert(newChildren.length > 0, 'children must be non empty');
        for (let j = 0; j < newChildren.length; j += 1) {
          parentNode.insertBefore(newChildren[j], textNode);
        }
        parentNode.removeChild(textNode);
      }
    });
  });
}

function textNodesUnder(el) {
  const a = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, mygoodfilter, false);
  let n = walk.nextNode();
  while (n) {
    a.push(n);
    n = walk.nextNode();
  }
  doHighlightText(a);
  // return a;
}

function onNodeInserted(event) {
  const inobj = event.target;
  if (!inobj) return;
  let classattr = null;
  if (typeof inobj.getAttribute !== 'function') {
    return;
  }
  try {
    classattr = inobj.getAttribute('class');
  } catch (e) {
    return;
  }
  if (!classattr || !classattr.startsWith('wdautohlen_')) {
    textNodesUnder(inobj);
    // const textNodes = textNodesUnder(inobj);
    // doHighlightText(textNodes);
  }
}

function unhighlight(lemma) {
  const hlNodes = document.querySelectorAll(`[class^=${classNamePrefix}${lemma}]`);
  // for (const hlNode of hlNodes) {
  hlNodes.forEach((hlNode) => {
    hlNode.setAttribute(
      'style',
      'font-weight:inherit;color:inherit;font-size:inherit;background-color:inherit;display:inline;',
    );
    hlNode.setAttribute('class', 'wdautohlen_none_none');
  });
}

function bubbleHandleTts(lexeme) {
  browser.runtime.sendMessage({ type: 'tts_speak', word: lexeme });
}

function bubbleHandleAddResult(report, lemma) {
  if (report === 'ok' || report === 'exists') {
    unhighlight(lemma);
  }
}

function hideBubble(force) {
  const bubbleDOM = document.getElementById('wd-selection-bubble-en');
  if (force || (!bubbleDOM.wdMouseOn && nodeToRenderId !== renderedNodeId)) {
    bubbleDOM.style.display = 'none';
    renderedNodeId = null;
    // console.log(bubbleDOM);
  }
}

function searchDict(e) {
  const dictUrl = e.target.getAttribute('wdDictRefUrl');
  const newTabUrl = getDictDefinitionUrl(dictUrl, currentLexeme);
  browser.runtime.sendMessage({ wdmNewTabUrl: newTabUrl });
}

function createBubble() {
  const bubbleDOM = document.createElement('div');
  // bubbleDOM.setAttribute('class', 'wd-selection-bubble-en');
  bubbleDOM.setAttribute('id', 'wd-selection-bubble-en');

  const infoSpan = document.createElement('span');
  infoSpan.setAttribute('id', 'wd-selection-bubble-text-en');
  // infoSpan.setAttribute('class', 'wd-infoSpanJA');
  bubbleDOM.appendChild(infoSpan);

  const freqSpan = document.createElement('span');
  freqSpan.setAttribute('id', 'wd-selection-bubble-freq-en');
  // freqSpan.setAttribute('class', 'wdFreqSpanJA');
  freqSpan.textContent = 'n/a';
  bubbleDOM.appendChild(freqSpan);

  const addButton = document.createElement('button');
  addButton.setAttribute('class', 'wd-add-button-en');
  addButton.textContent = browser.i18n.getMessage('menuItem');
  addButton.style.marginBottom = '4px';
  addButton.addEventListener('click', () => {
    addLexeme(currentLexeme, bubbleHandleAddResult);
  });
  bubbleDOM.appendChild(addButton);

  const speakButton = document.createElement('button');
  speakButton.setAttribute('class', 'wd-add-button-en');
  speakButton.textContent = 'Audio';
  speakButton.style.marginBottom = '4px';
  speakButton.addEventListener('click', () => {
    bubbleHandleTts(currentLexeme);
  });
  bubbleDOM.appendChild(speakButton);

  // dictPairs = makeDictionaryPairs();
  const dictPairs = wdOnlineDicts;
  for (let i = 0; i < dictPairs.length; i += 1) {
    const dictButton = document.createElement('button');
    dictButton.setAttribute('class', 'wd-add-button-en');
    dictButton.textContent = dictPairs[i].title;
    dictButton.setAttribute('wdDictRefUrl', dictPairs[i].url);
    dictButton.addEventListener('click', searchDict);
    bubbleDOM.appendChild(dictButton);
  }

  bubbleDOM.addEventListener('mouseleave', () => {
    bubbleDOM.wdMouseOn = false;
    hideBubble(false);
  });
  bubbleDOM.addEventListener('mouseenter', () => {
    bubbleDOM.wdMouseOn = true;
  });

  return bubbleDOM;
}

function renderBubble() {
  if (!nodeToRenderId) return;
  if (nodeToRenderId === renderedNodeId) return;

  const nodeToRender = document.getElementById(nodeToRenderId);
  if (!nodeToRender) return;

  const classattr = nodeToRender.getAttribute('class');
  const isHighlighted = classattr !== 'wdautohlen_none_none';
  const paramKey = isHighlighted ? 'hl_hover' : 'ow_hover';
  const paramValue = wdHoverSettings[paramKey];
  if (paramValue === 'never' || (paramValue === 'key' && !functionKeyIsPressed)) {
    return;
  }

  const bubbleDOM = document.getElementById('wd-selection-bubble-en');
  const bubbleText = document.getElementById('wd-selection-bubble-text-en');
  const bubbleFreq = document.getElementById('wd-selection-bubble-freq-en');
  [, currentLexeme, bubbleFreq.textContent] = classattr.split('_');
  bubbleText.textContent = limitTextLen(currentLexeme);
  const [rank] = bubbleFreq.textContent.split(':');
  bubbleFreq.style.backgroundColor = getHeatColorPoint((rank / wordMaxRank) * 100);
  const bcr = nodeToRender.getBoundingClientRect();
  bubbleDOM.style.top = `${bcr.bottom}px`;
  bubbleDOM.style.left = `${Math.max(5, Math.floor((bcr.left + bcr.right) / 2) - 100)}px`;
  bubbleDOM.style.display = 'block';
  renderedNodeId = nodeToRenderId;

  if (wdEnableTTS) {
    browser.runtime.sendMessage({ type: 'tts_speak', word: currentLexeme });
  }
}

function processHlLeave() {
  nodeToRenderId = null;
  setTimeout(() => {
    hideBubble(false);
  }, 100);
}

function processMouse(e) {
  const hitNode = document.elementFromPoint(e.clientX, e.clientY);
  if (!hitNode) {
    processHlLeave();
    return;
  }
  let classattr = null;
  try {
    classattr = hitNode.getAttribute('class');
  } catch (exc) {
    processHlLeave();
    return;
  }
  if (!classattr || !classattr.startsWith('wdautohlen_')) {
    processHlLeave();
    return;
  }
  nodeToRenderId = hitNode.id;
  setTimeout(() => {
    renderBubble();
  }, 200);
}

function getVerdict(isEnabled, wdBlackList, wdWhiteList, hostname) {
  if (Object.prototype.hasOwnProperty.call(wdBlackList, hostname)) {
    return 'site in "Skip List"';
  }
  if (Object.prototype.hasOwnProperty.call(wdWhiteList, hostname)) {
    return 'highlight';
  }
  return isEnabled ? 'highlight' : 'site is not in "Favorites List"';
}

function initForPage() {
  if (!document.body) return;

  browser.storage.local
    .get([
      'wdOnlineDicts',
      'wdHoverSettings',
      'wdIsEnabled',
      'wdUserVocabulary',
      'wdHlSettings',
      'wdBlackList',
      'wdWhiteList',
      'wdEnableTTS',
      'wdMinimunRank',
    ])
    .then((result) => {
      const { wdIsEnabled, wdBlackList, wdWhiteList } = result;
      const { hostname } = window.location;
      // window.location document.URL document.location.href
      const verdict = getVerdict(wdIsEnabled, wdBlackList, wdWhiteList, hostname);
      // to change icon
      browser.runtime.sendMessage({ wdmVerdict: verdict });
      if (verdict !== 'highlight') return;

      const frequencylist = browser.runtime.getURL('../data/frequencylist.csv');
      readFile(frequencylist).then((text) => {
        dictWords = processData(text);
        wordMaxRank = dictWords.length - 1;

        textNodesUnder(document.body);
        document.addEventListener('DOMNodeInserted', onNodeInserted, false);
      });

      wdOnlineDicts = result.wdOnlineDicts;
      wdEnableTTS = result.wdEnableTTS;
      userVocabulary = result.wdUserVocabulary;
      wdHoverSettings = result.wdHoverSettings;
      wdHlSettings = result.wdHlSettings;
      wdMinimunRank = result.wdMinimunRank;
      // dict_words = result.words_discoverer_eng_dict;
      // dict_idioms = result.wd_idioms;
      // const show_percents = result.wd_show_percents;

      browser.runtime.onMessage.addListener((request) => {
        if (request.wdm_unhighlight) {
          const lemma = request.wdm_unhighlight;
          unhighlight(lemma);
        }
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Control') {
          functionKeyIsPressed = true;
          renderBubble();
          // return;
        }
        // var elementTagName = event.target.tagName;
        // if (!disable_by_keypress && elementTagName != 'BODY') {
        //   // workaround to prevent highlighting in facebook messages
        //   // this logic can also be helpful in other situations,
        //   // it's better play safe and stop highlighting when user enters data.
        //   disable_by_keypress = true;
        //   chrome.runtime.sendMessage({ wdmVerdict: 'keyboard' });
        // }
      });

      document.addEventListener('keyup', (event) => {
        if (event.key === 'Control') {
          functionKeyIsPressed = false;
        }
      });

      const bubbleDOM = createBubble();
      document.body.appendChild(bubbleDOM);
      // document.addEventListener('mousedown', hideBubble(true), false);
      document.addEventListener('mousemove', processMouse, false);
      window.addEventListener('scroll', () => {
        nodeToRenderId = null;
        hideBubble(true);
      });
      // });
    });
}

document.addEventListener('DOMContentLoaded', () => {
  initForPage();
});
