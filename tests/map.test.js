// @flow

const os = require('os');
const path = require('path');
const uuid = require('uuid');
const level = require('level');
const { getSwarm, closeAllNodes } = require('./lib/ipfs');
const { IpfsObservedRemoveMap } = require('../src');
const { generateValue } = require('./lib/values');
const expect = require('expect');
const waitForHashing = require('./lib/wait-for-hashing');
require('./lib/async-iterator-comparison');

jest.setTimeout(30000);

let nodes = [];

describe('IPFS Map', () => {
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

  test('Synchronize maps', async () => {
    const topic = uuid.v4();
    const keyX = uuid.v4();
    const keyY = uuid.v4();
    const keyZ = uuid.v4();
    const valueX = generateValue();
    const valueY = generateValue();
    const valueZ = generateValue();
    const alice: IpfsObservedRemoveMap<Object> = new IpfsObservedRemoveMap(db, nodes[0], topic, [], { namespace: uuid.v4() });
    const bob: IpfsObservedRemoveMap<Object> = new IpfsObservedRemoveMap(db, nodes[1], topic, [], { namespace: uuid.v4() });
    await Promise.all([alice.readyPromise, bob.readyPromise]);
    let aliceAddCount = 0;
    let bobAddCount = 0;
    let aliceDeleteCount = 0;
    let bobDeleteCount = 0;
    alice.on('set', () => (aliceAddCount += 1));
    bob.on('set', () => (bobAddCount += 1));
    alice.on('delete', () => (aliceDeleteCount += 1));
    bob.on('delete', () => (bobDeleteCount += 1));
    await alice.set(keyX, valueX);
    await alice.set(keyY, valueY);
    await alice.set(keyZ, valueZ);
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
    await bob.delete(keyX);
    await bob.delete(keyY);
    await bob.delete(keyZ);
    while (aliceDeleteCount !== 3 || bobDeleteCount !== 3) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await expect(alice.get(keyX)).resolves.toBeUndefined();
    await expect(alice.get(keyY)).resolves.toBeUndefined();
    await expect(alice.get(keyZ)).resolves.toBeUndefined();
    await expect(bob.get(keyX)).resolves.toBeUndefined();
    await expect(bob.get(keyY)).resolves.toBeUndefined();
    await expect(bob.get(keyZ)).resolves.toBeUndefined();
    await expect(alice).asyncIteratesTo([]);
    await expect(bob).asyncIteratesTo([]);
    await alice.shutdown();
    await bob.shutdown();
  });


  test('Synchronize set and delete events', async () => {
    const topic = uuid.v4();
    const keyX = uuid.v4();
    const keyY = uuid.v4();
    const valueX = generateValue();
    const valueY = generateValue();
    const alice = new IpfsObservedRemoveMap(db, nodes[0], topic, [], { namespace: uuid.v4() });
    const bob = new IpfsObservedRemoveMap(db, nodes[1], topic, [], { namespace: uuid.v4() });
    await Promise.all([alice.readyPromise, bob.readyPromise]);
    const aliceSetXPromise = new Promise((resolve) => {
      alice.once('set', (key, value) => {
        expect(key).toEqual(keyX);
        expect(value).toEqual(valueX);
        resolve();
      });
    });
    const aliceDeleteXPromise = new Promise((resolve) => {
      alice.once('delete', (key, value) => {
        expect(key).toEqual(keyX);
        expect(value).toEqual(valueX);
        resolve();
      });
    });
    await bob.set(keyX, valueX);
    await aliceSetXPromise;
    await bob.delete(keyX);
    await aliceDeleteXPromise;
    const bobSetYPromise = new Promise((resolve) => {
      bob.once('set', (key, value) => {
        expect(key).toEqual(keyY);
        expect(value).toEqual(valueY);
        resolve();
      });
    });
    const bobDeleteYPromise = new Promise((resolve) => {
      bob.once('delete', (key, value) => {
        expect(key).toEqual(keyY);
        expect(value).toEqual(valueY);
        resolve();
      });
    });
    await alice.set(keyY, valueY);
    await bobSetYPromise;
    await alice.delete(keyY);
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
    const alice = new IpfsObservedRemoveMap(db, nodes[0], topic, [[keyA, valueA], [keyB, valueB], [keyC, valueC]], { namespace: uuid.v4(), bufferPublishing: 30000 });
    const bob = new IpfsObservedRemoveMap(db, nodes[1], topic, [[keyX, valueX], [keyY, valueY], [keyZ, valueZ]], { namespace: uuid.v4(), bufferPublishing: 30000 });
    await Promise.all([bob.readyPromise, alice.readyPromise]);
    await waitForHashing([alice, bob]);
    await expect(alice.dump()).resolves.toEqual(await bob.dump());
    await expect(alice.getIpfsHash()).resolves.toEqual(await bob.getIpfsHash());
    clearTimeout(alice.publishTimeout);
    clearTimeout(bob.publishTimeout);
    await alice.shutdown();
    await bob.shutdown();
  });
});
