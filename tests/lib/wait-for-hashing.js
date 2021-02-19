// @flow

const { IpfsObservedRemoveMap, IpfsSignedObservedRemoveMap } = require('../../src');
const { debounce } = require('lodash');

module.exports = async (maps: Array<IpfsObservedRemoveMap<any> | IpfsSignedObservedRemoveMap<any>>) => new Promise((resolve, reject) => {
  let didResolve = false;
  const areEqual = async () => {
    if (didResolve) {
      return false;
    }
    for (const map of maps) {
      if (map.isLoadingHashes) {
        // console.log('isLoadingHashes');
        return false;
      }
    }
    try {
      const hash = await maps[0].getIpfsHash();
      for (let i = 1; i < maps.length; i += 1) {
        if (await maps[i].getIpfsHash() !== hash) {
          // console.log('hash does not match');
          return false;
        }
      }
      for (const map of maps) {
        if (map.isLoadingHashes) {
          // console.log('isLoadingHashes 2');
          return false;
        }
      }
    } catch (error) {
      if (error.type === 'aborted') {
        // console.log('aborted');
        return false;
      }
      throw error;
    }
    return true;
  };
  const handleTimeout = async () => {
    if (!(await areEqual())) {
      timeout = setTimeout(handleTimeout, 100);
      return;
    }
    for (const map of maps) {
      map.removeListener('error', handleError);
      map.removeListener('hash', handleHashesLoaded);
    }
    didResolve = true;
    resolve();
  };
  let timeout = setTimeout(handleTimeout, 100);
  const handleError = (error) => {
    clearTimeout(timeout);
    for (const map of maps) {
      map.removeListener('error', handleError);
      map.removeListener('hash', handleHashesLoaded);
    }
    didResolve = true;
    reject(error);
  };
  const handleHashesLoaded = debounce(async () => {
    clearTimeout(timeout);
    if (await areEqual()) {
      for (const map of maps) {
        map.removeListener('error', handleError);
        map.removeListener('hash', handleHashesLoaded);
      }
      clearTimeout(timeout);
      didResolve = true;
      resolve();
      return;
    }
    timeout = setTimeout(handleTimeout, 100);
  }, 100);
  for (const map of maps) {
    map.on('error', handleError);
    map.on('hashesloaded', handleHashesLoaded);
  }
});
