// @flow

const os = require('os');
const path = require('path');
const uuid = require('uuid');
const level = require('level');
const stringify = require('json-stringify-deterministic');
const { getSwarm, closeAllNodes } = require('./lib/ipfs');
const { IpfsObservedRemoveMap } = require('../src');
const { generateValue } = require('./lib/values');

jest.setTimeout(30000);

const COUNT = 10;
let nodes = [];

describe('Map Scale', () => {
  let db;

  beforeAll(async () => {
    nodes = await getSwarm(COUNT);
    const location = path.join(os.tmpdir(), uuid.v4());
    db = level(location, { valueEncoding: 'json' });
  });

  afterAll(async () => {
    await db.close();
    await closeAllNodes();
  });

  test(`Synchronizes ${COUNT} maps`, async () => {
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
    const maps = nodes.map((node) => {
      const map = new IpfsObservedRemoveMap(db, node, topic, [], { namespace: uuid.v4() });
      aMapPromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyA && stringify(value) === stringify(valueA)) {
            map.removeListener('set', handler);
            resolve();
          }
        };
        map.on('set', handler);
      }));
      bMapPromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyB && stringify(value) === stringify(valueB)) {
            map.removeListener('set', handler);
            resolve();
          }
        };
        map.on('set', handler);
      }));
      cMapPromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyC && stringify(value) === stringify(valueC)) {
            map.removeListener('set', handler);
            resolve();
          }
        };
        map.on('set', handler);
      }));
      aDeletePromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyA && stringify(value) === stringify(valueA)) {
            map.removeListener('delete', handler);
            resolve();
          }
        };
        map.on('delete', handler);
      }));
      bDeletePromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyB && stringify(value) === stringify(valueB)) {
            map.removeListener('delete', handler);
            resolve();
          }
        };
        map.on('delete', handler);
      }));
      cDeletePromises.push(new Promise((resolve) => {
        const handler = (key, value) => {
          if (key === keyC && stringify(value) === stringify(valueC)) {
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
    await Promise.all(maps.map((map) => map.shutdown()));
  });

  test(`Synchronizes ${COUNT} maps automatically`, async () => {
    const topic = uuid.v4();
    const maps = [new IpfsObservedRemoveMap(db, nodes[0], topic, [[uuid.v4(), generateValue()]], { namespace: uuid.v4() })];
    await maps[0].readyPromise;
    const mapPromises = [];
    for (let i = 1; i < nodes.length; i += 1) {
      const map = new IpfsObservedRemoveMap(db, nodes[i], topic, [], { namespace: uuid.v4() });
      maps.push(map);
      mapPromises.push(new Promise((resolve) => {
        const handler = () => {
          map.removeListener('set', handler);
          resolve();
        };
        map.on('set', handler);
      }));
    }
    await Promise.all(maps.map((map) => map.readyPromise));
    await Promise.all(mapPromises);
    const dump = await maps[0].dump();
    for (let i = 1; i < maps.length; i += 1) {
      expect(maps[i].dump()).resolves.toEqual(dump);
    }
    await Promise.all(maps.map((map) => map.shutdown()));
  });
});

