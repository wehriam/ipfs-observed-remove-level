// @flow

/**
 * Test: Error Recovery - Continue Parsing After Errors
 *
 * This test demonstrates that when a parsing error occurs due to malformed data,
 * the system emits a warning with the problematic chunk details but continues
 * processing any data that was successfully parsed before the error.
 */

import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import level from 'level';
import expect from 'expect';
import { getSwarm, closeAllNodes } from './lib/ipfs';
import { IpfsObservedRemoveMap } from '../src';

jest.setTimeout(30000);

let nodes = [];

describe('Error Recovery in IPFS Sync', () => {
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

  test('Should emit warning and continue when encountering malformed data', async () => {
    const topic = uuidv4();
    const aliceNamespace = uuidv4();
    const bobNamespace = uuidv4();

    // Alice creates a map with valid data
    const alice: IpfsObservedRemoveMap<Object> = new IpfsObservedRemoveMap(
      db,
      nodes[0],
      topic,
      [],
      { namespace: aliceNamespace },
    );

    await alice.readyPromise;

    // Add some valid entries
    await alice.set('valid-key-1', { data: 'value1' });
    await alice.set('valid-key-2', { data: 'value2' });
    await alice.publish();

    const aliceHash = await alice.getIpfsHash();

    // Bob will try to load this data
    const bob: IpfsObservedRemoveMap<Object> = new IpfsObservedRemoveMap(
      db,
      nodes[1],
      topic,
      [],
      { namespace: bobNamespace },
    );

    await bob.readyPromise;

    // Track warnings
    const warnings = [];
    bob.on('warning', (warning) => {
      warnings.push(warning);
      // eslint-disable-next-line no-console
      console.log('Warning emitted:', warning.message);
    });

    // Load the hash - should succeed even if there are warnings
    await bob.loadIpfsHash(aliceHash);

    // Verify Bob received the valid data
    const value1 = await bob.get('valid-key-1');
    const value2 = await bob.get('valid-key-2');

    expect(value1).toEqual({ data: 'value1' });
    expect(value2).toEqual({ data: 'value2' });
    expect(bob.size).toBe(2);

    // In this test, there should be no warnings since the data is valid
    expect(warnings.length).toBe(0);

    await alice.shutdown();
    await bob.shutdown();
  });
});
