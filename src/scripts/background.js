import browser from 'webextension-polyfill';
import { initContextMenus, makeDefaultOnlineDicts } from './lib/context_menu_lib';

// TODO check chrome.runtime.lastError for all storage.local operations
/* global gapi */
let gapiLoaded = false;
let gapiInited = false;

function reportSyncFailure(errorMsg) {
  browser.storage.local.set({ wdLastSyncError: errorMsg }).then(() => {
    browser.runtime.sendMessage({ sync_feedback: 1 });
  });
}

function loadScript(url, callbackFunc) {
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
}

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

function listToSet(srcList) {
  const result = {};
  for (let i = 0; i < srcList.length; i += 1) {
    result[srcList[i]] = 1;
  }
  return result;
}

function substractFromSet(lhsSet, rhsSet) {
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
}

function addToSet(lhsSet, rhsSet) {
  // for (var key in rhsSet) {
  Object.keys(rhsSet).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(rhsSet, key)) {
      // eslint-disable-next-line no-param-reassign
      lhsSet[key] = 1;
    }
  });
}

function serializeVocabulary(entries) {
  const keys = [];
  Object.keys(entries).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(entries, key)) {
      keys.push(key);
    }
  });
  keys.sort();
  return keys.join('\r\n');
}

function parseVocabulary(text) {
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
}

function createNewDir(dirName, successCb) {
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
  gapi.client.request(reqParams).then((jsonResp) => {
    if (jsonResp.status === 200) {
      successCb(jsonResp.result.id);
    } else {
      reportSyncFailure(`Bad dir create status: ${jsonResp.status}`);
    }
  });
}

function createNewFile(fname, parentDirId, successCb) {
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
  gapi.client.request(reqParams).then((jsonResp) => {
    if (jsonResp.status === 200) {
      successCb(jsonResp.result.id);
    } else {
      reportSyncFailure(`Bad file create status: ${jsonResp.status}`);
    }
  });
}

function uploadFileContent(fileId, fileContent, successCb) {
  const reqParams = {
    path: `https://www.googleapis.com/upload/drive/v3/files/${fileId}`,
    method: 'PATCH',
    body: fileContent,
  };
  gapi.client.request(reqParams).then((jsonResp) => {
    if (jsonResp.status === 200) {
      successCb();
    } else {
      reportSyncFailure(`Bad upload content status: ${jsonResp.status}`);
    }
  });
}

function fetchFileContent(fileId, successCb) {
  // https://developers.google.com/drive/v3/web/manage-downloads
  const fullQueryUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  gapi.client.request({ path: fullQueryUrl, method: 'GET' }).then((jsonResp) => {
    if (jsonResp.status !== 200) {
      reportSyncFailure(`Bad status: ${jsonResp.status} for getting content of file: ${fileId}`);
      return;
    }
    const fileContent = jsonResp.body;
    successCb(fileId, fileContent);
  });
}

function findGdriveId(query, foundCb, notFoundCb) {
  // generic function to find single object id
  const fullQueryUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`;
  gapi.client.request({ path: fullQueryUrl, method: 'GET' }).then((jsonResp) => {
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
  });
}

function applyCloudVocab(entries) {
  const syncDate = new Date();
  const syncTime = syncDate.getTime();
  const newState = {
    wdLastSyncError: null,
    wdUserVocabulary: entries,
    wdUserVocabAdded: {},
    wdUserVocabDeleted: {},
    wdLastSync: syncTime,
  };
  browser.storage.local.set(newState).then(() => {
    browser.runtime.sendMessage({ sync_feedback: 1 });
  });
}

function syncVocabulary(dirId, vocab) {
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
}

function backupVocabulary(dirId, vocab, successCb) {
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
}

function performFullSync(vocab) {
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
}

function syncUserVocabularies() {
  browser.storage.local
    .get(['wdUserVocabulary', 'wdUserVocabAdded', 'wdUserVocabDeleted'])
    .then((result) => {
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
    });
}

function authorizeUser(interactiveAuthorization) {
  browser.identity.getAuthToken({ interactive: interactiveAuthorization }, (token) => {
    if (token === undefined) {
      reportSyncFailure('Unable to get oauth token');
    } else {
      gapi.client.setToken({ access_token: token });
      syncUserVocabularies();
    }
  });
}

function initGapi(interactiveAuthorization) {
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
}

function loadAndInitGapi(interactiveAuthorization) {
  loadScript('https://apis.google.com/js/api.js', () => {
    gapi.load('client', () => {
      gapiLoaded = true;
      initGapi(interactiveAuthorization);
    });
  });
}

// TODO: why set wdLastSyncError: 'Unknown sync problem' }
function startSyncSequence(interactiveAuthorization) {
  browser.storage.local.set({ wdLastSyncError: 'Unknown sync problem' }).then(() => {
    if (!gapiLoaded) {
      loadAndInitGapi(interactiveAuthorization);
    } else if (!gapiInited) {
      initGapi(interactiveAuthorization);
    } else {
      authorizeUser(interactiveAuthorization);
    }
  });
}

function initializeExtension() {
  browser.runtime.onMessage.addListener((request, sender) => {
    if (request.wdmVerdict) {
      if (request.wdmVerdict === 'highlight') {
        let result;
        browser.storage.local
          .get(['wdGdSyncEnabled', 'wdLastSyncError'])
          .then((getResult) => {
            result = getResult;
            return browser.browserAction.setIcon({
              path: '../images/result48.png',
              tabId: sender.tab.id,
            });
          })
          .then(() => {
            if (result.wdGdSyncEnabled) {
              if (result.wdLastSyncError == null) {
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
          });
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
    } else if (request.type === 'tts_speak') {
      if (request.word && typeof request.word === 'string') {
        browser.tts.speak(request.word, { lang: 'en' });
      }
    }
  });

  browser.storage.local
    .get([
      'wdHlSettings',
      'wdOnlineDicts',
      'wdHoverSettings',
      'wdIsEnabled',
      'wdUserVocabulary',
      'wdBlackList',
      'wdWhiteList',
      'wdGdSyncEnabled',
      'wdEnableTTS',
      'wdMinimunRank',
    ])
    // 'jhJpnDict',
    .then((result) => {
      // load_eng_dictionary();
      // load_idioms();
      if (typeof result.wdMinimunRank === 'undefined') {
        browser.storage.local.set({ wdMinimunRank: 6000 });
      }

      let { wdHlSettings } = result;
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
        const idiomHlParams = {
          enabled: true,
          quoted: false,
          bold: true,
          useBackground: false,
          backgroundColor: 'rgb(255, 248, 220)',
          useColor: true,
          color: 'blue',
        };
        wdHlSettings = {
          wordParams: wordHlParams,
          idiomParams: idiomHlParams,
        };
        browser.storage.local.set({ wdHlSettings });
      }
      const { wdEnableTTS } = result;
      if (typeof wdEnableTTS === 'undefined') {
        browser.storage.local.set({ wdEnableTTS: false });
      }
      let { wdHoverSettings } = result;
      if (typeof wdHoverSettings === 'undefined') {
        wdHoverSettings = {
          hl_hover: 'always',
          ow_hover: 'never',
        };
        browser.storage.local.set({ wdHoverSettings });
      }
      let { wdOnlineDicts } = result;
      if (typeof wdOnlineDicts === 'undefined') {
        wdOnlineDicts = makeDefaultOnlineDicts();
        browser.storage.local.set({ wdOnlineDicts });
      }
      initContextMenus(wdOnlineDicts);

      const { wdIsEnabled } = result;
      if (typeof wdIsEnabled === 'undefined') {
        browser.storage.local.set({ wdIsEnabled: true });
      }
      const { wdUserVocabulary } = result;
      if (typeof wdUserVocabulary === 'undefined') {
        browser.storage.local.set({ wdUserVocabulary: {} });
      }
      const { wdBlackList } = result;
      if (typeof wdBlackList === 'undefined') {
        browser.storage.local.set({ wdBlackList: {} });
      }
      const { wdWhiteList } = result;
      if (typeof wdWhiteList === 'undefined') {
        browser.storage.local.set({ wdWhiteList: {} });
      }
    });
}

initializeExtension();
