// @flow

const os = require('os');
const path = require('path');
const uuid = require('uuid');
const level = require('level');
const { getSwarm, closeAllNodes } = require('./lib/ipfs');
const { getSigner, generateId, IpfsSignedObservedRemoveMap, InvalidSignatureError } = require('../src');
const { generateValue } = require('./lib/values');
const expect = require('expect');
const NodeRSA = require('node-rsa');
const waitForHashing = require('./lib/wait-for-hashing');
require('./lib/async-iterator-comparison');

const privateKey = new NodeRSA({ b: 512 });
const sign = getSigner(privateKey.exportKey('pkcs1-private-pem'));
const key = privateKey.exportKey('pkcs1-public-pem');

jest.setTimeout(30000);

let nodes = [];


describe('IPFS Signed Map', () => {
  let db;

  beforeAll(async () => {
    nodes = await getSwarm(2);
    const location = path.join(os.tmpdir(), uuid.v4());
    db = level(location, { valueEncoding: 'json' });
  });

  afterAll(async () => {
    await db.close();
    await closeAllNodes();
  });

  test('Load from a hash', async () => {
    const topicA = uuid.v4();
    const topicB = uuid.v4();
    const keyA = uuid.v4();
    const keyB = uuid.v4();
    const keyC = uuid.v4();
    const idA = generateId();
    const idB = generateId();
    const idC = generateId();
    const valueA = generateValue();
    const valueB = generateValue();
    const valueC = generateValue();
    const alice = new IpfsSignedObservedRemoveMap(db, nodes[0], topicA, [[keyA, valueA, idA, sign(keyA, valueA, idA)], [keyB, valueB, idB, sign(keyB, valueB, idB)], [keyC, valueC, idC, sign(keyC, valueC, idC)]], { key, namespace: uuid.v4() });
    await alice.readyPromise;
    const hash = await alice.getIpfsHash();
    const bob = new IpfsSignedObservedRemoveMap(db, nodes[0], topicB, [], { key, namespace: uuid.v4() });
    await bob.readyPromise;
    await bob.loadIpfsHash(hash);
    await expect(bob.get(keyA)).resolves.toEqual(valueA);
    await expect(bob.get(keyB)).resolves.toEqual(valueB);
    await expect(bob.get(keyC)).resolves.toEqual(valueC);
    await alice.shutdown();
    await bob.shutdown();
  });

  test('Throw on invalid signatures', async () => {
    const topic = uuid.v4();
    const keyA = uuid.v4();
    const valueA = generateValue();
    const map = new IpfsSignedObservedRemoveMap(db, nodes[0], topic, [], { key, namespace: uuid.v4() });
    const invalidMap = new IpfsSignedObservedRemoveMap(db, nodes[0], uuid.v4(), [[keyA, valueA, generateId(), '***']], { key, namespace: uuid.v4() });
    await expect(invalidMap.readyPromise).rejects.toThrowError(InvalidSignatureError);
    await expect(map.setSigned(keyA, valueA, generateId(), '***')).rejects.toThrowError(InvalidSignatureError);
    const id = generateId();
    await map.setSigned(keyA, valueA, id, sign(keyA, valueA, id));
    await expect(map.deleteSigned(keyA, id, '***')).rejects.toThrowError(InvalidSignatureError);
    await map.shutdown();
  });

  test('Emit errors on invalid synchronization', async () => {
    const topic = uuid.v4();
    const alicePrivateKey = new NodeRSA({ b: 512 });
    const aliceSign = getSigner(alicePrivateKey.exportKey('pkcs1-private-pem'));
    const aliceKey = alicePrivateKey.exportKey('pkcs1-public-pem');
    const bobPrivateKey = new NodeRSA({ b: 512 });
    const bobSign = getSigner(bobPrivateKey.exportKey('pkcs1-private-pem'));
    const bobKey = bobPrivateKey.exportKey('pkcs1-public-pem');
    const keyX = uuid.v4();
    const keyY = uuid.v4();
    const valueX = generateValue();
    const valueY = generateValue();
    const alice = new IpfsSignedObservedRemoveMap(db, nodes[0], topic, [], { key: aliceKey, namespace: uuid.v4() });
    const bob = new IpfsSignedObservedRemoveMap(db, nodes[1], topic, [], { key: bobKey, namespace: uuid.v4() });
    await Promise.all([alice.readyPromise, bob.readyPromise]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const id1 = generateId();
    const aliceProcessSetMessage = new Promise((resolve, reject) => {
      alice.on('error', reject);
      alice.on('set', resolve);
      bob.setSigned(keyX, valueX, id1, bobSign(keyX, valueX, id1));
    });
    await expect(aliceProcessSetMessage).rejects.toThrowError(InvalidSignatureError);
    const id2 = generateId();
    const bobProcessSetMessage = new Promise((resolve, reject) => {
      bob.on('error', reject);
      bob.on('set', resolve);
      alice.setSigned(keyY, valueY, id2, aliceSign(keyY, valueY, id2));
    });
    await expect(bobProcessSetMessage).rejects.toThrowError(InvalidSignatureError);
    const aliceProcessDeleteMessage = new Promise((resolve, reject) => {
      alice.on('error', reject);
      alice.on('delete', resolve);
      bob.deleteSigned(keyX, id1, bobSign(keyX, id1));
    });
    await expect(aliceProcessDeleteMessage).rejects.toThrowError(InvalidSignatureError);
    await expect(alice.deleteSigned(keyY, id2, bobSign(keyY, id2))).rejects.toThrowError(InvalidSignatureError);
    await alice.shutdown();
    await bob.shutdown();
  });

  test('Synchronize maps', async () => {
    const topic = uuid.v4();
    const keyX = uuid.v4();
    const keyY = uuid.v4();
    const keyZ = uuid.v4();
    const valueX = generateValue();
    const valueY = generateValue();
    const valueZ = generateValue();
    const alice = new IpfsSignedObservedRemoveMap(db, nodes[0], topic, [], { key, namespace: uuid.v4() });
    const bob = new IpfsSignedObservedRemoveMap(db, nodes[1], topic, [], { key, namespace: uuid.v4() });
    alice.on('error', (error) => console.error(error));
    bob.on('error', (error) => console.error(error));
    await Promise.all([alice.readyPromise, bob.readyPromise]);
    let aliceAddCount = 0;
    let bobAddCount = 0;
    let aliceDeleteCount = 0;
    let bobDeleteCount = 0;
    alice.on('set', () => (aliceAddCount += 1));
    bob.on('set', () => (bobAddCount += 1));
    alice.on('delete', () => (aliceDeleteCount += 1));
    bob.on('delete', () => (bobDeleteCount += 1));
    const id1 = generateId();
    await alice.setSigned(keyX, valueX, id1, sign(keyX, valueX, id1));
    const id2 = generateId();
    await alice.setSigned(keyY, valueY, id2, sign(keyY, valueY, id2));
    const id3 = generateId();
    await alice.setSigned(keyZ, valueZ, id3, sign(keyZ, valueZ, id3));
    while (aliceAddCount !== 3 || bobAddCount !== 3) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await expect(alice.get(keyX)).resolves.toEqual(valueX);
    await expect(alice.get(keyY)).resolves.toEqual(valueY);
    await expect(alice.get(keyZ)).resolves.toEqual(valueZ);
    await expect(bob.get(keyX)).resolves.toEqual(valueX);
    await expect(bob.get(keyY)).resolves.toEqual(valueY);
    await expect(bob.get(keyZ)).resolves.toEqual(valueZ);
    await expect(alice).asyncIteratesTo(expect.arrayContaining([[keyX, valueX], [keyY, valueY], [keyZ, valueZ]]));
    await expect(bob).asyncIteratesTo(expect.arrayContaining([[keyX, valueX], [keyY, valueY], [keyZ, valueZ]]));
    await bob.deleteSigned(keyX, id1, sign(keyX, id1));
    await bob.deleteSigned(keyY, id2, sign(keyY, id2));
    await bob.deleteSigned(keyZ, id3, sign(keyZ, id3));
    while (aliceDeleteCount !== 3 || bobDeleteCount !== 3) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await expect(alice.get(keyX)).resolves.toBeUndefined();
    await expect(alice.get(keyY)).resolves.toBeUndefined();
    await expect(alice.get(keyZ)).resolves.toBeUndefined();
    await expect(bob.get(keyX)).resolves.toBeUndefined();
    await expect(bob.get(keyY)).resolves.toBeUndefined();
    await expect(bob.get(keyZ)).resolves.toBeUndefined();
    await expect(alice).asyncIteratesTo(expect.arrayContaining([]));
    await expect(bob).asyncIteratesTo(expect.arrayContaining([]));
    await alice.shutdown();
    await bob.shutdown();
  });

  test('Synchronize set and delete events', async () => {
    const topic = uuid.v4();
    const keyX = uuid.v4();
    const keyY = uuid.v4();
    const valueX = generateValue();
    const valueY = generateValue();
    const idX = generateId();
    const idY = generateId();
    const alice = new IpfsSignedObservedRemoveMap(db, nodes[0], topic, [], { key, namespace: uuid.v4() });
    const bob = new IpfsSignedObservedRemoveMap(db, nodes[1], topic, [], { key, namespace: uuid.v4() });
    await Promise.all([alice.readyPromise, bob.readyPromise]);
    const aliceSetXPromise = new Promise((resolve) => {
      alice.on('set', (k, v) => {
        if (k === keyX) {
          expect(v).toEqual(valueX);
          resolve();
        }
      });
    });
    const aliceDeleteXPromise = new Promise((resolve) => {
      alice.on('delete', (k, v) => {
        if (k === keyX) {
          expect(v).toEqual(valueX);
          resolve();
        }
      });
    });
    await bob.setSigned(keyX, valueX, idX, sign(keyX, valueX, idX));
    await aliceSetXPromise;
    await bob.deleteSigned(keyX, idX, sign(keyX, idX));
    await aliceDeleteXPromise;
    const bobSetYPromise = new Promise((resolve) => {
      bob.on('set', (k, v) => {
        expect(k).toEqual(keyY);
        expect(v).toEqual(valueY);
        resolve();
      });
    });
    const bobDeleteYPromise = new Promise((resolve) => {
      bob.on('delete', (k, v) => {
        if (k === keyY) {
          expect(v).toEqual(valueY);
          resolve();
        }
      });
    });
    await alice.setSigned(keyY, valueY, idY, sign(keyY, valueY, idY));
    await bobSetYPromise;
    await alice.deleteSigned(keyY, idY, sign(keyY, idY));
    await bobDeleteYPromise;
    await alice.shutdown();
    await bob.shutdown();
  });


  test('Synchronize mixed maps using sync', async () => {
    const topic = uuid.v4();
    const keyA = uuid.v4();
    const keyB = uuid.v4();
    const keyC = uuid.v4();
    const keyX = uuid.v4();
    const keyY = uuid.v4();
    const keyZ = uuid.v4();
    const valueA = generateValue();
    const valueB = generateValue();
    const valueC = generateValue();
    const valueX = generateValue();
    const valueY = generateValue();
    const valueZ = generateValue();
    const idA = generateId();
    const idB = generateId();
    const idC = generateId();
    const idX = generateId();
    const idY = generateId();
    const idZ = generateId();
    const alice = new IpfsSignedObservedRemoveMap(db, nodes[0], topic, [[keyA, valueA, idA, sign(keyA, valueA, idA)], [keyB, valueB, idB, sign(keyB, valueB, idB)], [keyC, valueC, idC, sign(keyC, valueC, idC)]], { key, namespace: uuid.v4() });
    const bob = new IpfsSignedObservedRemoveMap(db, nodes[1], topic, [[keyX, valueX, idX, sign(keyX, valueX, idX)], [keyY, valueY, idY, sign(keyY, valueY, idY)], [keyZ, valueZ, idZ, sign(keyZ, valueZ, idZ)]], { key, namespace: uuid.v4() });
    await Promise.all([bob.readyPromise, alice.readyPromise]);
    await waitForHashing([alice, bob]);
    await expect(alice.dump()).resolves.toEqual(await bob.dump());
    await alice.shutdown();
    await bob.shutdown();
  });
});

