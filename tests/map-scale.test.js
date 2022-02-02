// @flow

import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import level from 'level';
import { getSwarm, closeAllNodes } from './lib/ipfs';
import { IpfsObservedRemoveMap } from '../src';
import { generateValue } from './lib/values';
import waitForHashing from './lib/wait-for-hashing';

jest.setTimeout(60000);

const COUNT = 10;
let nodes = [];

describe('Map Scale', () => {
  let db;
  let maps;

  beforeAll(async () => {
    nodes = await getSwarm(COUNT);
    const location = path.join(os.tmpdir(), uuidv4());
    db = level(location, { valueEncoding: 'json' });
  });

  afterAll(async () => {
    for (const map of maps) {
      await map.shutdown();
    }
    await closeAllNodes();
    await db.close();
  });

  test(`Synchronizes ${COUNT} maps automatically`, async () => {
    const topic = uuidv4();
    maps = [new IpfsObservedRemoveMap(db, nodes[0], topic, [[uuidv4(), generateValue()]], { namespace: uuidv4(), bufferPublishing: 600000 })];
    await maps[0].readyPromise;
    for (let i = 1; i < nodes.length; i += 1) {
      const map = new IpfsObservedRemoveMap(db, nodes[i], topic, [], { namespace: uuidv4(), bufferPublishing: 600000 });
      maps.push(map);
      map.on('error', console.error);
    }
    for (let i = 0; i < 3; i += 1) {
      const map = maps[Math.floor(Math.random() * maps.length)];
      await map.set(uuidv4(), generateValue());
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

