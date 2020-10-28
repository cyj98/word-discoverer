import browser from 'webextension-polyfill';
import { syncIfNeeded } from './lib/common_lib';

const listSectionNames = {
  wdBlackList: 'black-list-section',
  wdWhiteList: 'white-list-section',
  wdUserVocabulary: 'vocabulary-section',
};

const deleteBlackWhiteList = async (event, listName) => {
  const key = event.target.dataset.text;
  const result = await browser.storage.local.get([listName]);
  const userList = result[listName];
  delete userList[key];
  browser.storage.local.set({ [listName]: userList });
  event.target.parentElement.remove();
};

const deleteUserDictionary = async (event) => {
  const key = event.target.dataset.text;
  const result = await browser.storage.local.get([
    'wdUserVocabulary',
    'wdUserVocabAdded',
    'wdUserVocabDeleted',
  ]);
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
  await browser.storage.local.set(newState);
  syncIfNeeded();
  event.target.parentElement.remove();
};

const createLabel = (text) => {
  const textElement = document.createElement('span');
  textElement.className = 'word-text';
  textElement.textContent = text;
  return textElement;
};

const createButton = (listName, text) => {
  const deleteButtonElement = document.createElement('input');
  deleteButtonElement.className = 'delete-button';
  deleteButtonElement.src = '../images/delete.png';
  deleteButtonElement.type = 'image';
  deleteButtonElement.dataset.text = text;
  if (listName === 'wdUserVocabulary') {
    deleteButtonElement.addEventListener('click', (event) => {
      deleteUserDictionary(event);
    });
  } else {
    deleteButtonElement.addEventListener('click', (event) => {
      deleteBlackWhiteList(event, listName);
    });
  }
  return deleteButtonElement;
};

const showList = (listName, list) => {
  const sectionName = listSectionNames[listName];
  const sectionElement = document.getElementById(sectionName);
  if (!Object.keys(list).length) {
    sectionElement.appendChild(createLabel(browser.i18n.getMessage('emptyListError')));
    return;
  }
  Object.keys(list).forEach((key) => {
    if (key.indexOf("'") !== -1 || key.indexOf('"') !== -1) {
      return;
    }
    const divElement = document.createElement('div');
    divElement.style = 'display:flex; align-items: center;';
    divElement.appendChild(createButton(listName, key));
    divElement.appendChild(createLabel(key));
    sectionElement.appendChild(divElement);
  });
};

const processDisplay = async () => {
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

  const result = await browser.storage.local.get([listName]);
  const userList = result[listName];
  showList(listName, userList);
};

document.addEventListener('DOMContentLoaded', () => {
  processDisplay();
});
