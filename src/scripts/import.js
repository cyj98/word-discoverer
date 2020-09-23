import browser from 'webextension-polyfill';
import { syncIfNeeded, localizeHtmlPage } from './lib/common_lib';

function parseVocabulary(text) {
  const lines = text.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    let word = lines[i];
    if (i + 1 === lines.length && word.length <= 1) break;
    if (word.slice(-1) === '\r') {
      word = word.slice(0, -1);
    }
    found.push(word);
  }
  return found;
}

function addNewWords(newWords) {
  browser.storage.local
    .get(['wdUserVocabulary', 'wdUserVocabAdded', 'wdUserVocabDeleted'])
    .then((result) => {
      const { wdUserVocabulary, wdUserVocabAdded, wdUserVocabDeleted } = result;
      let numAdded = 0;
      const newState = { wdUserVocabulary };
      for (let i = 0; i < newWords.length; i += 1) {
        const word = newWords[i];
        if (!Object.prototype.hasOwnProperty.call(wdUserVocabulary, word)) {
          wdUserVocabulary[word] = 1;
          numAdded += 1;
          if (typeof wdUserVocabAdded !== 'undefined') {
            wdUserVocabAdded[word] = 1;
            newState.wdUserVocabAdded = wdUserVocabAdded;
          }
          if (typeof wdUserVocabDeleted !== 'undefined') {
            delete wdUserVocabDeleted[word];
            newState.wdUserVocabDeleted = wdUserVocabDeleted;
          }
        }
      }
      if (numAdded) {
        browser.storage.local.set(newState).then(() => {
          syncIfNeeded();
        });
      }
      const numSkipped = newWords.length - numAdded;
      document.getElementById('added-info').textContent = `Added ${numAdded} new words.`;
      document.getElementById('skipped-info').textContent = `Skipped ${numSkipped} existing words.`;
    });
}

function processChange() {
  const inputElem = document.getElementById('do-load-vocab');
  const baseName = inputElem.files[0].name;
  document.getElementById('frame-preview').textContent = baseName;
}

function processSubmit() {
  // TODO add a radio button with two options: 1. merge vocabulary [default]; 2. replace vocabulary
  const inputElem = document.getElementById('do-load-vocab');
  const file = inputElem.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    const newWords = parseVocabulary(reader.result);
    addNewWords(newWords);
  };
  reader.readAsText(file);
}

function initControls() {
  window.onload = () => {
    localizeHtmlPage();
    document.getElementById('vocab-submit').addEventListener('click', processSubmit);
    document.getElementById('do-load-vocab').addEventListener('change', processChange);
  };
}

initControls();
