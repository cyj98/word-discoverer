import browser from 'webextension-polyfill';

export const requestUnhighlight = async (lemma) => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  browser.tabs.sendMessage(tabs[0].id, { wdm_unhighlight: lemma });
};

// export function make_id_suffix(text) {
// const before = btoa(text);
// return before.replace(/\+/g, '_').replace(/\//g, '-').replace(/=/g, '_')
// return after;
// }

export const syncIfNeeded = async () => {
  const reqKeys = ['wdLastSync', 'wdGdSyncEnabled', 'wdLastSyncError'];
  const result = await browser.storage.local.get(reqKeys);
  const { wdLastSync, wdGdSyncEnabled, wdLastSyncError } = result;
  if (!wdGdSyncEnabled || wdLastSyncError !== null) {
    return;
  }
  const curDate = new Date();
  const minsPassed = (curDate.getTime() - wdLastSync) / (60 * 1000);
  const syncPeriodMins = 30;
  if (minsPassed >= syncPeriodMins) {
    browser.runtime.sendMessage({
      wdmRequest: 'gd_sync',
      interactiveMode: false,
    });
  }
};

export const readFile = (_path) =>
  new Promise((resolve, reject) => {
    fetch(_path)
      .then((_res) => _res.blob())
      .then((_blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(_blob);
      })
      .catch((error) => {
        reject(error);
      });
  });

export const processData = (allText) => {
  const allTextLines = allText.split(/\r\n|\n/);
  const headers = allTextLines[0].split(',');
  const dictWords = {};

  for (let i = 1; i < allTextLines.length; i += 1) {
    const data = allTextLines[i].split(',');
    // console.log(allTextLines[i], data);
    if (data.length === headers.length) {
      dictWords[data[1]] = { [headers[0]]: data[0], [headers[2]]: data[2] };
    }
  }
  return dictWords;
};

// TODO: check should I assign to argument
export const addLexeme = async (lexemeOld, resultHandler) => {
  const reqKeys = ['wdUserVocabulary', 'wdUserVocabAdded', 'wdUserVocabDeleted'];
  const result = await browser.storage.local.get(reqKeys);
  // var dict_idioms = result.wd_idioms;
  const { wdUserVocabulary, wdUserVocabAdded, wdUserVocabDeleted } = result;
  if (lexemeOld.length > 100) {
    resultHandler('bad', undefined);
    return;
  }
  // lexeme = lexeme.toLowerCase();
  const lexeme = lexemeOld.trim();
  if (!lexeme) {
    resultHandler('bad', undefined);
    return;
  }

  let key = lexeme;
  const frequencylist = browser.runtime.getURL('../data/frequencylist.csv');
  const text = await readFile(frequencylist);
  const dictWords = processData(text);
  const wordFound = dictWords[lexeme];
  if (wordFound) {
    [key] = wordFound;
  }
  if (Object.prototype.hasOwnProperty.call(wdUserVocabulary, key)) {
    resultHandler('exists', key);
    return;
  }

  const newState = { wdUserVocabulary };

  wdUserVocabulary[key] = 1;
  if (typeof wdUserVocabAdded !== 'undefined') {
    wdUserVocabAdded[key] = 1;
    newState.wdUserVocabAdded = wdUserVocabAdded;
  }
  if (typeof wdUserVocabDeleted !== 'undefined') {
    delete wdUserVocabDeleted[key];
    newState.wdUserVocabDeleted = wdUserVocabDeleted;
  }

  await browser.storage.local.set(newState);
  syncIfNeeded();
  resultHandler('ok', key);
};

export const makeHlStyle = (hlParams) => {
  if (!hlParams.enabled) return undefined;
  let result = '';
  if (hlParams.bold) result += 'font-weight:bold;';
  if (hlParams.useBackground) result += `background-color:${hlParams.backgroundColor};`;
  if (hlParams.useColor) result += `color:${hlParams.color};`;
  if (!result) return undefined;
  result += 'font-size:inherit;display:inline;';
  return result;
};

export const localizeHtmlPage = () => {
  // Localize by replacing __MSG_***__ meta tags
  const objects = document.getElementsByTagName('html');
  for (let j = 0; j < objects.length; j += 1) {
    const obj = objects[j];
    const valStrH = obj.innerHTML.toString();
    const valNewH = valStrH.replace(/__MSG_(\w+)__/g, (match, v1) =>
      v1 ? browser.i18n.getMessage(v1) : '',
    );
    if (valNewH !== valStrH) {
      obj.innerHTML = valNewH;
    }
  }
};

export const spformat = (src, ...args) => {
  // const args = Array.prototype.slice.call(arguments, 1);
  return src.replace(/{(\d+)}/g, (match, number) =>
    typeof args[number] !== 'undefined' ? args[number] : match,
  );
};
