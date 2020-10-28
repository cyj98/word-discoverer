import browser from 'webextension-polyfill';
import { readFile, processData } from './lib/common_lib';
import { initContextMenus, makeDefaultOnlineDicts } from './lib/context_menu_lib';

/* global gapi */
let gapiLoaded = false;
let gapiInited = false;

const reportSyncFailure = async (errorMsg) => {
  await browser.storage.local.set({ wdLastSyncError: errorMsg });
  browser.runtime.sendMessage({ sync_feedback: 1 });
};

const loadScript = (url, callbackFunc) => {
  const request = new XMLHttpRequest();
  request.onreadystatechange = () => {
    if (request.readyState !== 4) return;
    if (request.status !== 200) return;
    // eslint-disable-next-line no-eval
    eval(request.responseText);
    callbackFunc();
  };
  request.open('GET', url);
  request.send();
};

// function transform_key(src_key) {
//     var dc = window.atob(src_key)
//     dc = dc.substring(3)
//     dc = dc.substring(0, dc.length - 6)
//     return dc
// }

// function generate_key() {
//     var protokey =
//         'b2ZCQUl6YVN5Q2hqM2xvZkJPWnV2TUt2TGNCSlVaa0RDTUhZa25NWktBa25NWktB'
//     return transform_key(protokey)
// }

const listToSet = (srcList) => {
  const result = {};
  for (let i = 0; i < srcList.length; i += 1) {
    result[srcList[i]] = 1;
  }
  return result;
};

const substractFromSet = (lhsSet, rhsSet) => {
  // for (var key in rhsSet) {
  Object.keys(rhsSet).forEach((key) => {
    if (
      Object.prototype.hasOwnProperty.call(rhsSet, key) &&
      Object.prototype.hasOwnProperty.call(lhsSet, key)
    ) {
      // eslint-disable-next-line no-param-reassign
      delete lhsSet[key];
    }
  });
};

const addToSet = (lhsSet, rhsSet) => {
  // for (var key in rhsSet) {
  Object.keys(rhsSet).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(rhsSet, key)) {
      // eslint-disable-next-line no-param-reassign
      lhsSet[key] = 1;
    }
  });
};

const serializeVocabulary = (entries) => {
  const keys = [];
  Object.keys(entries).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(entries, key)) {
      keys.push(key);
    }
  });
  keys.sort();
  return keys.join('\r\n');
};

const parseVocabulary = (text) => {
  // code duplication with parse_vocabulary in import.js
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
};

const createNewDir = async (dirName, successCb) => {
  const body = {
    name: dirName,
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: { wdfile: '1' },
  };
  const reqParams = {
    path: 'https://www.googleapis.com/drive/v3/files/',
    method: 'POST',
    body,
  };
  const jsonResp = await gapi.client.request(reqParams);
  if (jsonResp.status === 200) {
    successCb(jsonResp.result.id);
  } else {
    reportSyncFailure(`Bad dir create status: ${jsonResp.status}`);
  }
};

const createNewFile = async (fname, parentDirId, successCb) => {
  const body = {
    name: fname,
    parents: [parentDirId],
    appProperties: { wdfile: '1' },
    mimeType: 'text/plain',
  };
  const reqParams = {
    path: 'https://www.googleapis.com/drive/v3/files',
    method: 'POST',
    body,
  };
  const jsonResp = await gapi.client.request(reqParams);
  if (jsonResp.status === 200) {
    successCb(jsonResp.result.id);
  } else {
    reportSyncFailure(`Bad file create status: ${jsonResp.status}`);
  }
};

const uploadFileContent = async (fileId, fileContent, successCb) => {
  const reqParams = {
    path: `https://www.googleapis.com/upload/drive/v3/files/${fileId}`,
    method: 'PATCH',
    body: fileContent,
  };
  const jsonResp = await gapi.client.request(reqParams);
  if (jsonResp.status === 200) {
    successCb();
  } else {
    reportSyncFailure(`Bad upload content status: ${jsonResp.status}`);
  }
};

const fetchFileContent = async (fileId, successCb) => {
  // https://developers.google.com/drive/v3/web/manage-downloads
  const fullQueryUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const jsonResp = await gapi.client.request({ path: fullQueryUrl, method: 'GET' });
  if (jsonResp.status !== 200) {
    reportSyncFailure(`Bad status: ${jsonResp.status} for getting content of file: ${fileId}`);
    return;
  }
  const fileContent = jsonResp.body;
  successCb(fileId, fileContent);
};

const findGdriveId = async (query, foundCb, notFoundCb) => {
  // generic function to find single object id
  const fullQueryUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`;
  const jsonResp = await gapi.client.request({ path: fullQueryUrl, method: 'GET' });
  if (jsonResp.status !== 200) {
    reportSyncFailure(`Bad status: ${jsonResp.status} for query: ${query}`);
    return;
  }
  if (jsonResp.result.files.length > 1) {
    reportSyncFailure(`More than one object found for query: ${query}`);
    return;
  }
  if (jsonResp.result.files.length === 1) {
    const driveId = jsonResp.result.files[0].id;
    foundCb(driveId);
    return;
  }
  notFoundCb();
};

const applyCloudVocab = async (entries) => {
  const syncDate = new Date();
  const syncTime = syncDate.getTime();
  const newState = {
    wdLastSyncError: null,
    wdUserVocabulary: entries,
    wdUserVocabAdded: {},
    wdUserVocabDeleted: {},
    wdLastSync: syncTime,
  };
  await browser.storage.local.set(newState);
  browser.runtime.sendMessage({ sync_feedback: 1 });
};

const syncVocabulary = (dirId, vocab) => {
  const mergeAndUploadVocab = (fileId, fileContent) => {
    const vocabList = parseVocabulary(fileContent);
    const entries = listToSet(vocabList);
    substractFromSet(entries, vocab.deleted);
    addToSet(entries, vocab.added);
    const mergedContent = serializeVocabulary(entries);

    const setMergedVocab = () => {
      applyCloudVocab(entries);
    };
    uploadFileContent(fileId, mergedContent, setMergedVocab);
  };

  const mergeVocabToCloud = (fileId) => {
    fetchFileContent(fileId, mergeAndUploadVocab);
  };

  const vocabFileName = `${vocab.name}.txt`;
  const fileQuery = `name = '${vocabFileName}' and trashed = false and appProperties has { key='wdfile' and value='1' } and '${dirId}' in parents`;
  const createNewFileWrap = () => {
    createNewFile(vocabFileName, dirId, mergeVocabToCloud);
    const newAdded = {};
    addToSet(newAdded, vocab.all);
    addToSet(newAdded, vocab.added);
    // eslint-disable-next-line no-param-reassign
    vocab.added = newAdded;
  };
  findGdriveId(fileQuery, mergeVocabToCloud, createNewFileWrap);
};

const backupVocabulary = (dirId, vocab, successCb) => {
  const mergeAndUploadBackup = (fileId, fileContent) => {
    const vocabList = parseVocabulary(fileContent);
    const entries = listToSet(vocabList);
    addToSet(entries, vocab.all);
    addToSet(entries, vocab.deleted);
    addToSet(entries, vocab.added);
    const mergedContent = serializeVocabulary(entries);
    uploadFileContent(fileId, mergedContent, successCb);
  };
  const mergeBackupToCloud = (fileId) => {
    fetchFileContent(fileId, mergeAndUploadBackup);
  };

  const backupFileName = `.${vocab.name}.backup`;
  const backupQuery = `name = '${backupFileName}' and trashed = false and appProperties has { key='wdfile' and value='1' } and '${dirId}' in parents`;
  const createNewBackupFileWrap = () => {
    createNewFile(backupFileName, dirId, mergeBackupToCloud);
  };
  findGdriveId(backupQuery, mergeBackupToCloud, createNewBackupFileWrap);
};

const performFullSync = (vocab) => {
  const dirName = 'English Highlighter Sync';
  const dirQuery = `name = '${dirName}' and trashed = false and appProperties has { key='wdfile' and value='1' }`;
  const backupAndSyncVocabulary = (dirId) => {
    const syncVocabularyWrap = () => {
      syncVocabulary(dirId, vocab);
    };
    backupVocabulary(dirId, vocab, syncVocabularyWrap);
  };
  const createNewDirWrap = () => {
    createNewDir(dirName, backupAndSyncVocabulary);
  };
  findGdriveId(dirQuery, backupAndSyncVocabulary, createNewDirWrap);
};

const syncUserVocabularies = async () => {
  const result = await browser.storage.local.get([
    'wdUserVocabulary',
    'wdUserVocabAdded',
    'wdUserVocabDeleted',
  ]);
  let { wdUserVocabulary } = result;
  let { wdUserVocabAdded } = result;
  let { wdUserVocabDeleted } = result;
  if (typeof wdUserVocabulary === 'undefined') {
    wdUserVocabulary = {};
  }
  if (typeof wdUserVocabAdded === 'undefined') {
    // wdUserVocabAdded = Object.assign({}, wdUserVocabulary);
    wdUserVocabAdded = { ...wdUserVocabulary };
  }
  if (typeof wdUserVocabDeleted === 'undefined') {
    wdUserVocabDeleted = {};
  }
  const vocab = {
    name: 'english_vocabulary',
    all: wdUserVocabulary,
    added: wdUserVocabAdded,
    deleted: wdUserVocabDeleted,
  };
  performFullSync(vocab);
};

const authorizeUser = (interactiveAuthorization) => {
  browser.identity.getAuthToken({ interactive: interactiveAuthorization }, (token) => {
    if (token === undefined) {
      reportSyncFailure('Unable to get oauth token');
    } else {
      gapi.client.setToken({ access_token: token });
      syncUserVocabularies();
    }
  });
};

const initGapi = (interactiveAuthorization) => {
  // const gapikey = generate_key()
  // const init_params = { apiKey: gapikey }
  const initParams = { apiKey: 'AIzaSyB8O49UstOB-K_hB09_HaDA4E-VN6qmHrw' };
  gapi.client.init(initParams).then(
    () => {
      gapiInited = true;
      authorizeUser(interactiveAuthorization);
    },
    (rejectReason) => {
      const errorMsg = `Unable to init client. Reject reason: ${rejectReason}`;
      reportSyncFailure(errorMsg);
    },
  );
};

const loadAndInitGapi = (interactiveAuthorization) => {
  loadScript('https://apis.google.com/js/api.js', () => {
    gapi.load('client', () => {
      gapiLoaded = true;
      initGapi(interactiveAuthorization);
    });
  });
};

// TODO: why set wdLastSyncError: 'Unknown sync problem' }
const startSyncSequence = async (interactiveAuthorization) => {
  await browser.storage.local.set({ wdLastSyncError: 'Unknown sync problem' });
  if (!gapiLoaded) {
    loadAndInitGapi(interactiveAuthorization);
  } else if (!gapiInited) {
    initGapi(interactiveAuthorization);
  } else {
    authorizeUser(interactiveAuthorization);
  }
};

const loadDictionary = async () => {
  const frequencylistURL = browser.runtime.getURL('../data/frequencylist.csv');
  const frequencylist = await readFile(frequencylistURL);
  const dictWords = processData(frequencylist);
  browser.storage.local.set({ dictWords });
};

const initializeExtension = async () => {
  loadDictionary();
  const result = await browser.storage.local.get([
    'wdHlSettings',
    'wdHoverSettings',
    'wdOnlineDicts',
    'wdIsEnabled',
    'wdUserVocabulary',
    'wdBlackList',
    'wdWhiteList',
    'wdEnableTTS',
    'wdMinimunRank',
  ]);

  let { wdHlSettings, wdHoverSettings } = result;
  const {
    wdOnlineDicts,
    wdEnableTTS,
    wdIsEnabled,
    wdUserVocabulary,
    wdBlackList,
    wdWhiteList,
    wdMinimunRank,
  } = result;
  if (typeof wdHlSettings === 'undefined') {
    const wordHlParams = {
      enabled: true,
      quoted: false,
      bold: true,
      useBackground: false,
      backgroundColor: 'rgb(255, 248, 220)',
      useColor: true,
      color: 'red',
    };
    // const idiomHlParams = {
    //   enabled: true,
    //   quoted: false,
    //   bold: true,
    //   useBackground: false,
    //   backgroundColor: 'rgb(255, 248, 220)',
    //   useColor: true,
    //   color: 'blue',
    // };
    wdHlSettings = {
      wordParams: wordHlParams,
      // idiomParams: idiomHlParams,
    };
    browser.storage.local.set({ wdHlSettings });
  }
  if (typeof wdHoverSettings === 'undefined') {
    wdHoverSettings = {
      hl_hover: 'always',
      ow_hover: 'never',
    };
    browser.storage.local.set({ wdHoverSettings });
  }
  if (typeof wdOnlineDicts === 'undefined') {
    browser.storage.local.set({ wdOnlineDicts: makeDefaultOnlineDicts() });
  }
  initContextMenus(wdOnlineDicts);
  if (typeof wdEnableTTS === 'undefined') {
    browser.storage.local.set({ wdEnableTTS: false });
  }
  if (typeof wdIsEnabled === 'undefined') {
    browser.storage.local.set({ wdIsEnabled: true });
  }
  if (typeof wdUserVocabulary === 'undefined') {
    browser.storage.local.set({ wdUserVocabulary: {} });
  }
  if (typeof wdBlackList === 'undefined') {
    browser.storage.local.set({ wdBlackList: {} });
  }
  if (typeof wdWhiteList === 'undefined') {
    browser.storage.local.set({ wdWhiteList: {} });
  }
  if (typeof wdMinimunRank === 'undefined') {
    browser.storage.local.set({ wdMinimunRank: 6000 });
  }

  browser.runtime.onMessage.addListener(async (request, sender) => {
    if (request.text) {
      // return
    } else if (request.wdmVerdict) {
      if (request.wdmVerdict === 'highlight') {
        // let result;
        const getResult = await browser.storage.local.get(['wdGdSyncEnabled', 'wdLastSyncError']);
        await browser.browserAction.setIcon({
          path: '../images/result48.png',
          tabId: sender.tab.id,
        });
        if (getResult.wdGdSyncEnabled) {
          if (getResult.wdLastSyncError == null) {
            browser.browserAction.setBadgeText({
              text: 'sync',
              tabId: sender.tab.id,
            });
            browser.browserAction.setBadgeBackgroundColor({
              color: [25, 137, 0, 255],
              tabId: sender.tab.id,
            });
          } else {
            browser.browserAction.setBadgeText({
              text: 'err',
              tabId: sender.tab.id,
            });
            browser.browserAction.setBadgeBackgroundColor({
              color: [137, 0, 0, 255],
              tabId: sender.tab.id,
            });
          }
        }
        // } else if (request.wdmVerdict === 'keyboard') {
        //   browser.browserAction.setIcon({
        //     path: '../images/no_dynamic.png',
        //     tabId: sender.tab.id,
        //   });
      } else {
        browser.browserAction.setIcon({
          path: '../images/result48_gray.png',
          tabId: sender.tab.id,
        });
      }
    } else if (request.wdmNewTabUrl) {
      const fullUrl = request.wdmNewTabUrl;
      browser.tabs.create({ url: fullUrl });
    } else if (request.wdmRequest === 'gd_sync') {
      startSyncSequence(request.interactiveMode);
    }
  });
};

initializeExtension();
