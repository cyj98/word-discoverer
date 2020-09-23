import browser from 'webextension-polyfill';
import { syncIfNeeded } from './lib/common_lib';

const listSectionNames = {
  wdBlackList: 'black-list-section',
  wdWhiteList: 'white-list-section',
  wdUserVocabulary: 'vocabulary-section',
};

function processDeleteSimple(listName, key) {
  browser.storage.local.get([listName]).then((result) => {
    const userList = result[listName];
    delete userList[key];
    browser.storage.local.set({ [listName]: userList });
    showUserList(listName, userList);
  });
}

function processDeleteVocabEntry(key) {
  browser.storage.local
    .get(['wdUserVocabulary', 'wdUserVocabAdded', 'wdUserVocabDeleted'])
    .then((result) => {
      const { wdUserVocabulary, wdUserVocabAdded, wdUserVocabDeleted } = result;
      const newState = { wdUserVocabulary };
      delete wdUserVocabulary[key];
      if (typeof wdUserVocabAdded !== 'undefined') {
        delete wdUserVocabAdded[key];
        newState.wdUserVocabAdded = wdUserVocabAdded;
      }
      if (typeof wdUserVocabDeleted !== 'undefined') {
        wdUserVocabDeleted[key] = 1;
        newState.wdUserVocabDeleted = wdUserVocabDeleted;
      }
      browser.storage.local.set(newState).then(() => {
        syncIfNeeded();
      });
      showUserList('wdUserVocabulary', wdUserVocabulary);
    });
}

function createButton(listName, text) {
  const result = document.createElement('button');
  result.setAttribute('class', 'delete-button');
  result.expression_text = text;
  if (listName === 'wdUserVocabulary') {
    result.addEventListener('click', function deleteVocabEntry() {
      processDeleteVocabEntry(this.expression_text);
    });
  } else {
    result.addEventListener('click', function deleteSimple() {
      processDeleteSimple(listName, this.expression_text);
    });
  }
  const img = document.createElement('img');
  img.setAttribute('src', '../images/delete.png');
  result.appendChild(img);
  return result;
}

function createLabel(text) {
  const result = document.createElement('span');
  result.setAttribute('class', 'word-text');
  result.textContent = text;
  return result;
}

function showUserList(listName, userList) {
  const keys = [];
  // for (const key in userList) {
  Object.keys(userList).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(userList, key)) {
      keys.push(key);
    }
  });
  const sectionName = listSectionNames[listName];
  const divElement = document.getElementById(sectionName);
  while (divElement.firstChild) {
    divElement.removeChild(divElement.firstChild);
  }
  if (!keys.length) {
    divElement.appendChild(createLabel(browser.i18n.getMessage('emptyListError')));
    divElement.appendChild(document.createElement('br'));
    return;
  }
  keys.forEach((key) => {
    if (key.indexOf("'") !== -1 || key.indexOf('"') !== -1) {
      return;
    }
    divElement.appendChild(createButton(listName, key));
    divElement.appendChild(createLabel(key));
    divElement.appendChild(document.createElement('br'));
  });
}

function processDisplay() {
  // TODO replace this clumsy logic by adding a special
  // "data-list-name" attribute and renaming all 3 tags to "userListSection"
  let listName;
  if (document.getElementById('black-list-section')) {
    listName = 'wdBlackList';
  } else if (document.getElementById('white-list-section')) {
    listName = 'wdWhiteList';
  } else {
    listName = 'wdUserVocabulary';
  }

  browser.storage.local.get([listName]).then((result) => {
    const userList = result[listName];
    showUserList(listName, userList);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  processDisplay();
});
