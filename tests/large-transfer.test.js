// @flow

import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import level from 'level';
import expect from 'expect';
import NodeRSA from 'node-rsa';
import { getSwarm, closeAllNodes } from './lib/ipfs';
import { getSigner, generateId, IpfsObservedRemoveMap, IpfsSignedObservedRemoveMap } from '../src';
import './lib/async-iterator-comparison';


jest.setTimeout(30000);

const privateKey = new NodeRSA({ b: 512 });
const sign = getSigner(privateKey.exportKey('pkcs1-private-pem'));
const publicKey = privateKey.exportKey('pkcs1-public-pem');

let nodes = [];

describe('IPFS Map', () => {
  let db;

  beforeAll(async () => {
    nodes = await getSwarm(2);
    const location = path.join(os.tmpdir(), uuidv4());
    db = level(location, { valueEncoding: 'json' });
  });

  afterAll(async () => {
    await db.close();
    await closeAllNodes();
  });

  test('Loads a 10 MB value', async () => {
    const topic = uuidv4();
    const key = uuidv4();
    const value = {};
    for (let i = 0; i < 134500; i += 1) {
      value[uuidv4()] = uuidv4();
    }
    const alice = new IpfsObservedRemoveMap(db, nodes[0], topic, undefined, { chunkPubSub: true, disableSync: true, bufferPublishing: 0, namespace: uuidv4() });
    await alice.readyPromise;
    const bob = new IpfsObservedRemoveMap(db, nodes[1], topic, undefined, { chunkPubSub: true, disableSync: true, bufferPublishing: 0, namespace: uuidv4() });
    await bob.readyPromise;
    const aliceSetPromise = new Promise((resolve) => {
      alice.once('set', (k, v) => {
        expect(k).toEqual(key);
        expect(v).toEqual(value);
        resolve();
      });
    });
    bob.set(key, value);
    await aliceSetPromise;
    await alice.shutdown();
    await bob.shutdown();
  });

  test('Loads a 10 MB value into a signed map', async () => {
    const topic = uuidv4();
    const key = uuidv4();
    const value = {};
    const id = generateId();
    for (let i = 0; i < 134500; i += 1) {
      value[uuidv4()] = uuidv4();
    }
    const alice = new IpfsSignedObservedRemoveMap(db, nodes[0], topic, [], { chunkPubSub: true, disableSync: true, bufferPublishing: 0, key: publicKey, namespace: uuidv4() });
    await alice.readyPromise;
    const bob = new IpfsSignedObservedRemoveMap(db, nodes[1], topic, [], { chunkPubSub: true, disableSync: true, bufferPublishing: 0, key: publicKey, namespace: uuidv4() });
    await bob.readyPromise;
    const aliceSetPromise = new Promise((resolve) => {
      alice.once('set', (k, v) => {
        expect(k).toEqual(key);
        expect(v).toEqual(value);
        resolve();
      });
    });
    await bob.setSigned(key, value, id, sign(key, value, id));
    await aliceSetPromise;
    await alice.shutdown();
    await bob.shutdown();
  });
});

