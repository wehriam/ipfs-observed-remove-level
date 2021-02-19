// @flow

const os = require('os');
const path = require('path');
const uuid = require('uuid');
const level = require('level');
const { getSwarm, closeAllNodes } = require('./lib/ipfs');
const { IpfsObservedRemoveMap } = require('../src');
const { generateValue } = require('./lib/values');
const waitForHashing = require('./lib/wait-for-hashing');

jest.setTimeout(60000);

const COUNT = 10;
let nodes = [];

process.argv.push('--inspect');

describe('Map Scale', () => {
  let db;
  let maps;

  beforeAll(async () => {
    nodes = await getSwarm(COUNT);
    const location = path.join(os.tmpdir(), uuid.v4());
    db = level(location, { valueEncoding: 'json' });
  });

  afterAll(async () => {
    await closeAllNodes();
    await db.close();
  });

  afterEach(async () => {
    await Promise.all(maps.map((map) => map.shutdown()));
  });

  test.skip(`Synchronizes ${COUNT} maps`, async () => {
    const topic = uuid.v4();
    const keyA = uuid.v4();
    const keyB = uuid.v4();
    const keyC = uuid.v4();
    const valueA = generateValue();
    const valueB = generateValue();
    const valueC = generateValue();
    const aMapPromises = [];
    const bMapPromises = [];
    const cMapPromises = [];
    const aDeletePromises = [];
    const bDeletePromises = [];
    const cDeletePromises = [];
    maps = nodes.map((node) => {
      const map = new IpfsObservedRemoveMap(db, node, topic, [], { namespace: uuid.v4() });
      aMapPromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyA && JSON.stringify(value) === JSON.stringify(valueA)) {
            map.removeListener('set', handler);
            resolve();
          }
        };
        map.on('set', handler);
      }));
      bMapPromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyB && JSON.stringify(value) === JSON.stringify(valueB)) {
            map.removeListener('set', handler);
            resolve();
          }
        };
        map.on('set', handler);
      }));
      cMapPromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyC && JSON.stringify(value) === JSON.stringify(valueC)) {
            map.removeListener('set', handler);
            resolve();
          }
        };
        map.on('set', handler);
      }));
      aDeletePromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyA && JSON.stringify(value) === JSON.stringify(valueA)) {
            map.removeListener('delete', handler);
            resolve();
          }
        };
        map.on('delete', handler);
      }));
      bDeletePromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyB && JSON.stringify(value) === JSON.stringify(valueB)) {
            map.removeListener('delete', handler);
            resolve();
          }
        };
        map.on('delete', handler);
      }));
      cDeletePromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyC && JSON.stringify(value) === JSON.stringify(valueC)) {
            map.removeListener('delete', handler);
            resolve();
          }
        };
        map.on('delete', handler);
      }));
      return map;
    });
    const randomMap = () => maps[Math.floor(Math.random() * maps.length)];
    await Promise.all(maps.map((map) => map.readyPromise));
    await randomMap().set(keyA, valueA);
    await Promise.all(aMapPromises);
    await randomMap().set(keyB, valueB);
    await Promise.all(bMapPromises);
    await randomMap().set(keyC, valueC);
    await Promise.all(cMapPromises);
    await randomMap().delete(keyA);
    await Promise.all(aDeletePromises);
    await randomMap().delete(keyB);
    await Promise.all(bDeletePromises);
    await randomMap().delete(keyC);
    await Promise.all(cDeletePromises);
  });

  test(`Synchronizes ${COUNT} maps automatically`, async () => {
    const topic = uuid.v4();
    maps = [new IpfsObservedRemoveMap(db, nodes[0], topic, [[uuid.v4(), generateValue()]], { namespace: uuid.v4(), bufferPublishing: 60000 })];
    await maps[0].readyPromise;
    for (let i = 1; i < nodes.length; i += 1) {
      const map = new IpfsObservedRemoveMap(db, nodes[i], topic, [], { namespace: uuid.v4(), bufferPublishing: 60000 });
      maps.push(map);
      map.on('error', console.error);
    }
    console.log('waiting for ready', Date.now());
    await Promise.all(maps.map((map) => map.readyPromise));
    console.log('ready', Date.now());
    for (let i = 0; i < 1000; i += 1) {
      const map = maps[Math.floor(Math.random() * maps.length)];
      await map.set(uuid.v4(), generateValue());
    }
    for (const map of maps) {
      map.ipfsSync();
    }
    await waitForHashing(maps);
    const hash = await maps[0].getIpfsHash();
    for (let i = 1; i < maps.length; i += 1) {
      await expect(maps[i].getIpfsHash()).resolves.toEqual(hash);
    }
  });
});

