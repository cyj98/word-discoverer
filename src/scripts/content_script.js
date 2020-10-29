import browser from 'webextension-polyfill';
// import nlp from 'compromise';
import { makeHlStyle, addLexeme } from './lib/common_lib';
import { getDictDefinitionUrl } from './lib/context_menu_lib';
import contentScriptStyle from '../styles/content_script.css';

const classNamePrefix = 'wdautohlen';
const haveEnglishRegex = /[-a-zA-Z]/;
const beginWithEnglishRegex = /^[a-z][a-z]*$/;
let dictWords;
let dictIdioms;

let userVocabulary = [];
let minimunRank = 1;
let highlightSettings = null;
let hoverSettings = null;
let onlineDicts = null;
let ttsEnabled = null;

// let disableByKeypress = false;

let currentLexeme = '';
// use to find node to render popup
let currentNodeId = 1;

let functionKeyIsPressed = false;
let renderedNodeId = null;
let nodeToRenderId = null;

const limitTextLen = (word) => {
  if (!word) return word;
  // word = word.toLowerCase();
  const maxLen = 20;
  if (word.length <= maxLen) return word;
  return `${word.slice(0, maxLen)}...`;
};

const getHeatColorPoint = (freqPercentOld) => {
  let freqPercent = freqPercentOld;
  if (!freqPercent) freqPercent = 0;
  freqPercent = Math.max(0, Math.min(100, freqPercent));
  const hue = 100 - freqPercent;
  return `hsl(${hue}, 100%, 50%)`;
};

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

const goodNodeFilter = (node) => {
  if (goodTagsList.indexOf(node.parentNode.tagName) !== -1) return NodeFilter.FILTER_ACCEPT;
  return NodeFilter.FILTER_SKIP;
};

const getRareLemma = (word) => {
  if (!userVocabulary) return undefined;
  if (word.length < 3) return undefined;
  const wordFound = dictWords[word];
  if (!wordFound || wordFound.rank < minimunRank) return undefined;
  wordFound.word = word;
  return !Object.prototype.hasOwnProperty.call(userVocabulary, wordFound.lemma)
    ? wordFound
    : undefined;
};

const textToHlNodes = (textNode) => {
  const { parentElement, textContent } = textNode;
  // const lowercaseText = textContent.toLowerCase();
  // let wsText = lcText.replace(/[,;()?!`:"'.\s\-\u2013\u2014\u201C\u201D\u2019]/g, ' ');
  // const wsText = lowercaseText.replace(/[^\w- ']/g, ' ');
  // wsText = wsText.replace(/[^\w ]/g, '.');

  const tokens = textContent.replace(/[^\w- ']/g, ' ').split(' ');

  let wordBeginIndex = 0;
  let wordNumber = 0;

  const tokenizeOther = hoverSettings.ow_hover !== 'never';

  let lastEndPos = 0;
  let newTextNode = textNode;
  while (wordNumber < tokens.length) {
    if (tokens[wordNumber].length) {
      let match;
      let textStyle;
      let className;
      if (!match && highlightSettings.idiomParams.enabled) {
        let lookAheadWordNumber = wordNumber;
        let lookAheadWordBeginIndex = wordBeginIndex;
        let idiomPrefix = '';
        while (lookAheadWordNumber < tokens.length) {
          idiomPrefix += tokens[lookAheadWordNumber];
          let idiomFound;
          if (Object.prototype.hasOwnProperty.call(dictIdioms, idiomPrefix.toLocaleLowerCase())) {
            idiomFound = dictIdioms[idiomPrefix.toLocaleLowerCase()];
          }
          if (
            idiomFound === -1 &&
            (!lookAheadWordBeginIndex || textContent[lookAheadWordBeginIndex - 1] === ' ')
          ) {
            // idiom prefix found
            idiomPrefix += ' ';
            lookAheadWordBeginIndex += tokens[lookAheadWordNumber].length + 1;
            lookAheadWordNumber += 1;
          } else if (
            idiomFound &&
            idiomFound !== -1 &&
            (!lookAheadWordBeginIndex || textContent[lookAheadWordBeginIndex - 1] === ' ')
          ) {
            // idiom found
            if (userVocabulary && Object.prototype.hasOwnProperty.call(userVocabulary, idiomFound))
              break;
            match = {
              original: idiomPrefix,
              // kind: 'idiom',
              begin: wordBeginIndex,
              // end: wordBeginIndex + idiomPrefix.length,
            };
            // console.log(idiomPrefix);
            textStyle = makeHlStyle(highlightSettings.idiomParams);
            className = idiomFound;
            wordBeginIndex += idiomPrefix.length + 1;
            wordNumber = lookAheadWordNumber + 1;
          } else {
            // idiom not found
            break;
          }
        }
      }
      if (!match && highlightSettings.wordParams.enabled) {
        const wordFound = getRareLemma(tokens[wordNumber].toLowerCase());
        if (wordFound) {
          match = {
            original: tokens[wordNumber],
            // normalized: wordFound.lemma,
            // kind: 'lemma',
            begin: wordBeginIndex,
            // end: ibegin + tokens[wnum].length,
            // rank: wordFound.rank,
            // count: wordFound.count,
          };
          wordBeginIndex += tokens[wordNumber].length + 1;
          wordNumber += 1;
          textStyle = makeHlStyle(highlightSettings.wordParams);
          className = `${wordFound.lemma}_${wordFound.rank}:${wordFound.count}`;
        }
      }
      if (
        tokenizeOther &&
        !match &&
        tokens[wordNumber].length >= 3 &&
        beginWithEnglishRegex.test(tokens[wordNumber])
      ) {
        match = {
          original: tokens[wordNumber],
          // kind: 'other',
          begin: wordBeginIndex,
        };
        textStyle = 'font:inherit;display:inline;color:inherit;background-color:inherit;';
        className = match.original;
        wordBeginIndex += tokens[wordNumber].length + 1;
        wordNumber += 1;
      }
      if (match) {
        parentElement.classList.add(classNamePrefix);
        const span = document.createElement('span');
        span.textContent = match.original;
        span.id = `${classNamePrefix}_${currentNodeId}`;
        span.className = `${classNamePrefix}_${className}`;
        span.style = textStyle;
        currentNodeId += 1;
        newTextNode = newTextNode.splitText(match.begin - lastEndPos);
        lastEndPos = match.begin + match.original.length;
        newTextNode.deleteData(0, match.original.length);
        parentElement.insertBefore(span, newTextNode);
      } else {
        wordBeginIndex += tokens[wordNumber].length + 1;
        wordNumber += 1;
      }
    } else {
      wordNumber += 1;
      wordBeginIndex += 1;
    }
  }
};

const doHighlightText = (textNode) => {
  if (textNode.nodeType !== Node.TEXT_NODE || dictWords === null || minimunRank === null) return;
  const { parentElement, textContent } = textNode;
  if (!parentElement) return;
  if (textContent.length <= 3) return;
  // pathetic hack to skip json data in text (e.g. google images use it).
  if (textContent.indexOf('{') !== -1 && textContent.indexOf('}') !== -1) return;
  if (!textContent.match(haveEnglishRegex)) return;
  textToHlNodes(textNode);
};

const textNodesUnder = (node) => {
  if (!node.parentElement || node.parentElement.className.includes(classNamePrefix)) return;
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (node.id && node.id.startsWith(classNamePrefix)) return;
    const nodeList = [];
    const treeWalker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, goodNodeFilter, false);
    let currentNode = treeWalker.nextNode();
    while (currentNode) {
      nodeList.push(currentNode);
      currentNode = treeWalker.nextNode();
    }
    nodeList.forEach((textNode) => doHighlightText(textNode));
  } else if (node.nodeType === Node.TEXT_NODE) {
    doHighlightText(node);
  }
};

const unhighlight = (lemma) => {
  const hlNodes = document.querySelectorAll(`[class^=${classNamePrefix}_${lemma}]`);
  // for (const hlNode of hlNodes) {
  hlNodes.forEach((hlNode) => {
    // eslint-disable-next-line no-param-reassign
    hlNode.style =
      'font-weight:inherit;color:inherit;font-size:inherit;background-color:inherit;display:inline;';
    // eslint-disable-next-line no-param-reassign
    hlNode.className = `${classNamePrefix}_none_none`;
  });
};

const bubbleHandleTts = (lexeme) => {
  const utterance = new SpeechSynthesisUtterance(lexeme);
  speechSynthesis.speak(utterance);
};

const bubbleHandleAddResult = (report, lemma) => {
  if (report === 'ok' || report === 'exists') {
    unhighlight(lemma);
  }
};

const searchDict = (e) => {
  const dictUrl = e.target.dataset.dictionaryReferenceUrl;
  const newTabUrl = getDictDefinitionUrl(dictUrl, currentLexeme);
  browser.runtime.sendMessage({ wdmNewTabUrl: newTabUrl });
};

const hideBubble = (force) => {
  const bubbleDOM = document
    .getElementById('wd-selection-bubble-container-en')
    .shadowRoot.getElementById('wd-selection-bubble');
  if (force || !bubbleDOM || (!bubbleDOM.wdMouseOn && nodeToRenderId !== renderedNodeId)) {
    bubbleDOM.style.display = 'none';
    renderedNodeId = null;
  }
};

const createBubble = () => {
  const bubbleDOMContainer = document.createElement('div');
  const shadow = bubbleDOMContainer.attachShadow({ mode: 'open' });
  bubbleDOMContainer.id = 'wd-selection-bubble-container-en';
  const bubbleDOM = document.createElement('div');
  const style = document.createElement('style');
  [[, style.textContent]] = contentScriptStyle;
  shadow.prepend(style);
  shadow.append(bubbleDOM);

  bubbleDOM.id = 'wd-selection-bubble';

  const infoSpan = document.createElement('span');
  infoSpan.id = 'wd-selection-bubble-text';
  bubbleDOM.appendChild(infoSpan);

  const freqSpan = document.createElement('span');
  freqSpan.id = 'wd-selection-bubble-freq';
  freqSpan.textContent = 'n/a';
  bubbleDOM.appendChild(freqSpan);

  const addButton = document.createElement('button');
  addButton.className = 'wd-add-button';
  addButton.textContent = browser.i18n.getMessage('menuItem');
  addButton.style.marginBottom = '4px';
  addButton.addEventListener('click', () => {
    addLexeme(currentLexeme, bubbleHandleAddResult);
  });
  bubbleDOM.appendChild(addButton);

  const speakButton = document.createElement('button');
  speakButton.className = 'wd-add-button';
  speakButton.textContent = 'Audio';
  speakButton.style.marginBottom = '4px';
  speakButton.addEventListener('click', () => {
    bubbleHandleTts(currentLexeme);
  });
  bubbleDOM.appendChild(speakButton);

  // dictPairs = makeDictionaryPairs();
  const dictPairs = onlineDicts;
  for (let i = 0; i < dictPairs.length; i += 1) {
    const dictButton = document.createElement('button');
    dictButton.className = 'wd-add-button';
    dictButton.textContent = dictPairs[i].title;
    dictButton.dataset.dictionaryReferenceUrl = dictPairs[i].url;
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

  // return bubbleDOM;
  return bubbleDOMContainer;
};

const renderBubble = () => {
  if (!nodeToRenderId) return;
  if (nodeToRenderId === renderedNodeId) return;

  const nodeToRender = document.getElementById(nodeToRenderId);
  if (!nodeToRender || nodeToRender.nodeType !== Node.ELEMENT_NODE) return;

  const { className } = nodeToRender;
  const isHighlighted = className !== `${classNamePrefix}_none_none`;
  const paramKey = isHighlighted ? 'hl_hover' : 'ow_hover';
  const paramValue = hoverSettings[paramKey];
  if (paramValue === 'never' || (paramValue === 'key' && !functionKeyIsPressed)) {
    return;
  }

  const shadow = document.getElementById('wd-selection-bubble-container-en').shadowRoot;
  const bubbleDOM = shadow.getElementById('wd-selection-bubble');
  const bubbleText = shadow.getElementById('wd-selection-bubble-text');
  const bubbleFreq = shadow.getElementById('wd-selection-bubble-freq');
  [, currentLexeme, bubbleFreq.textContent] = className.split('_');
  bubbleText.textContent = limitTextLen(currentLexeme);
  if (bubbleFreq.textContent) {
    const [rank] = bubbleFreq.textContent.split(':');
    bubbleFreq.style.backgroundColor = getHeatColorPoint((rank / dictWords.length) * 100);
    bubbleFreq.style.visibility = 'visible';
  } else {
    bubbleFreq.style.visibility = 'hidden';
  }
  const bcr = nodeToRender.getBoundingClientRect();
  bubbleDOM.style.top = `${bcr.bottom}px`;
  bubbleDOM.style.left = `${Math.max(5, Math.floor((bcr.left + bcr.right) / 2) - 100)}px`;
  bubbleDOM.style.display = 'block';
  renderedNodeId = nodeToRenderId;

  if (ttsEnabled) {
    const utterance = new SpeechSynthesisUtterance(currentLexeme);
    speechSynthesis.speak(utterance);
  }
};

const processHlLeave = () => {
  nodeToRenderId = null;
  setTimeout(() => {
    if (renderedNodeId) hideBubble(false);
  }, 300);
};

const processMouse = (e) => {
  const hitNode = document.elementFromPoint(e.clientX, e.clientY);
  if (!hitNode || hitNode.nodeType !== Node.ELEMENT_NODE) {
    processHlLeave();
    return;
  }
  const { className } = hitNode;
  try {
    if (!className || !className.startsWith(classNamePrefix)) {
      processHlLeave();
      return;
    }
  } catch (err) {
    console.error(err);
    console.log(className);
  }

  nodeToRenderId = hitNode.id;
  renderBubble();
};

const getVerdict = (isEnabled, blackList, whiteList, hostname) => {
  if (Object.prototype.hasOwnProperty.call(blackList, hostname)) {
    return 'site in "Skip List"';
  }
  if (Object.prototype.hasOwnProperty.call(whiteList, hostname)) {
    return 'highlight';
  }
  return isEnabled ? 'highlight' : 'site is not in "Favorites List"';
};

const initForPage = async () => {
  if (!document.body) return;

  const result = await browser.storage.local.get([
    'dictWords',
    'dictIdioms',
    'onlineDicts',
    'hoverSettings',
    'enabledMode',
    'userVocabulary',
    'highlightSettings',
    'blackList',
    'whiteList',
    'ttsEnabled',
    'minimunRank',
  ]);
  const { enabledMode, blackList, whiteList } = result;
  const { hostname } = window.location;
  // window.location document.URL document.location.href
  const verdict = getVerdict(enabledMode, blackList, whiteList, hostname);
  // to change icon
  browser.runtime.sendMessage({ wdmVerdict: verdict });
  if (verdict !== 'highlight') return;
  ({
    dictWords,
    dictIdioms,
    userVocabulary,
    onlineDicts,
    ttsEnabled,
    hoverSettings,
    highlightSettings,
    minimunRank,
  } = result);

  textNodesUnder(document.body);
  // document.addEventListener('DOMNodeInserted', onNodeInserted, false);
  const observer = new MutationObserver((mutationsList) => {
    mutationsList.forEach((mutation) => {
      Array.from(mutation.addedNodes).forEach((node) => {
        textNodesUnder(node);
      });
    });
  });
  observer.observe(document.body, { subtree: true, childList: true });

  browser.runtime.onMessage.addListener((request) => {
    if (request.wdm_unhighlight) {
      const lemma = request.wdm_unhighlight;
      unhighlight(lemma);
    }
  });

  const bubbleDOM = createBubble();
  document.body.appendChild(bubbleDOM);
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
  document.addEventListener('mousemove', processMouse, false);
  window.addEventListener('scroll', () => processHlLeave());
};

document.addEventListener('DOMContentLoaded', () => {
  initForPage();
});
