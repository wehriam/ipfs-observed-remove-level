// @flow

/**
 * Test: JSON Backslash Escaping Fix
 *
 * This test demonstrates and verifies the fix for the bug where Windows file paths
 * with backslashes would cause "Parser cannot parse input: escaped characters" errors.
 *
 * THE BUG:
 * When data containing backslashes (e.g., "C:\Users\file.txt") was stored in the map
 * and synced via IPFS, ReadableJsonDump would create malformed JSON by concatenating
 * raw buffers without proper escaping, resulting in invalid JSON like:
 *   [["key",["id",{"path":"C:\Users"}]]]
 *
 * THE FIX:
 * ReadableJsonDump now uses JSON.stringify() to properly escape keys before concatenating,
 * creating valid JSON:
 *   [["key",["id",{"path":"C:\\\\Users"}]]]
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

describe('Backslash Escaping in IPFS Sync', () => {
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

  test('Map with Windows file paths should sync correctly between peers', async () => {
    const topic = uuidv4();
    const aliceNamespace = uuidv4();
    const bobNamespace = uuidv4();

    // Use a Windows file path AS THE KEY - this is what triggers the bug!
    // When the key contains backslashes, ReadableJsonDump will create invalid JSON
    const windowsPath = 'C:\\Users\\Admin\\Documents\\project\\src\\index.js';

    // Create realistic file metadata
    const fileMetadata = {
      hash: 'QmX5ZaYA3k2vkLcP3sP7g8R6HqV9mN2BzT',
      mimetype: 'application/javascript',
      size: 2048,
      description: 'File with Windows path as key',
    };

    // Alice creates a map and adds the file metadata
    const alice: IpfsObservedRemoveMap<Object> = new IpfsObservedRemoveMap(
      db,
      nodes[0],
      topic,
      [],
      { namespace: aliceNamespace },
    );

    await alice.readyPromise;

    // Alice adds file with Windows path AS THE KEY
    await alice.set(windowsPath, fileMetadata);

    // Force Alice to publish to ensure data is written to LevelDB
    await alice.publish();

    // Alice creates IPFS hash (this internally uses ReadableJsonDump)
    const aliceHash = await alice.getIpfsHash();

    // Bob will sync from Alice using a different namespace
    // This forces Bob to load the data from IPFS instead of local LevelDB
    const bob: IpfsObservedRemoveMap<Object> = new IpfsObservedRemoveMap(
      db,
      nodes[1],
      topic,
      [],
      { namespace: bobNamespace },
    );

    await bob.readyPromise;

    // Bob loads Alice's IPFS hash
    // WITHOUT THE FIX: This throws "Parser cannot parse input: escaped characters"
    // WITH THE FIX: This succeeds
    await bob.loadIpfsHash(aliceHash);

    // Verify Bob received the correct data with the Windows path key intact
    const bobData = await bob.get(windowsPath);
    expect(bobData).toEqual(fileMetadata);
    // Verify the key with backslashes is present in the map
    expect(bob.size).toBe(1);

    await alice.shutdown();
    await bob.shutdown();
  });
});
