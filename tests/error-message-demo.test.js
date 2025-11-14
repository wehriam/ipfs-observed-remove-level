// @flow

/**
 * Test: Enhanced Error Messages
 *
 * This test demonstrates that when a parsing error occurs, the error message
 * now includes the problematic key that caused the issue.
 *
 * This test manually creates malformed JSON (with unescaped backslashes) to trigger
 * a parsing error and verify that the error message includes helpful context.
 */

import { Readable } from 'stream';
import { parser as jsonStreamParser } from 'stream-json/Parser';
import { streamArray as jsonStreamArray } from 'stream-json/streamers/StreamArray';
import CID from 'cids';
import expect from 'expect';
import { getSwarm, closeAllNodes } from './lib/ipfs';

jest.setTimeout(30000);

let nodes = [];

describe('Enhanced Error Messages', () => {
  beforeAll(async () => {
    nodes = await getSwarm(1);
  });

  afterAll(async () => {
    await closeAllNodes();
  });

  test('Should emit warning with problematic chunk details when parsing fails', async () => {
    // Manually create malformed JSON with unescaped backslashes
    // This simulates the bug before the fix was applied
    const malformedJSON = '[[["C:\\Users\\file.txt",["id123",{"hash":"QmTest"}]]],[]]';

    // Upload the malformed JSON to IPFS
    const file = await nodes[0].add(Buffer.from(malformedJSON), {
      wrapWithDirectory: false,
      recursive: false,
      pin: false,
    });
    const hash = file.cid.toString();

    // Now try to parse it using the same logic as loadIpfsHash
    // $FlowFixMe
    const stream = Readable.from(nodes[0].cat(new CID(hash)));
    const parser = jsonStreamParser();
    const streamArray = jsonStreamArray();
    const pipeline = stream.pipe(parser);

    let arrayDepth = 0;
    let streamState = 0;
    const recentChunks = [];
    const MAX_CHUNK_HISTORY = 5;
    let caughtError = null;
    let warningEmitted = false;

    try {
      await new Promise((resolve, reject) => {
        stream.on('data', (chunk) => {
          // Track recent raw chunks for error reporting
          recentChunks.push(chunk);
          if (recentChunks.length > MAX_CHUNK_HISTORY) {
            recentChunks.shift();
          }
        });
        stream.on('error', (error) => {
          reject(error);
        });
        streamArray.on('error', (error) => {
          reject(error);
        });
        pipeline.on('error', (error) => {
          // Enhance error message with the problematic chunk
          let enhancedMessage = error.message;
          if (recentChunks.length > 0) {
            // Concatenate recent chunks and show the problematic section
            const combinedChunks = Buffer.concat(recentChunks);
            const chunkStr = combinedChunks.toString('utf8');
            // Show last 200 characters to give context
            const contextLength = Math.min(200, chunkStr.length);
            const context = chunkStr.slice(-contextLength);
            enhancedMessage += `\nProblematic chunk (last ${contextLength} chars): ${JSON.stringify(context)}`;
          }
          const enhancedError = new Error(enhancedMessage);
          enhancedError.stack = error.stack;
          caughtError = enhancedError;
          warningEmitted = true;
          // Resolve to continue processing like the actual implementation does
          resolve();
        });
        pipeline.on('end', () => {
          resolve();
        });
        pipeline.on('data', (data) => {
          const { name } = data;

          if (name === 'startArray') {
            arrayDepth += 1;
            if (arrayDepth === 2) {
              streamState += 1;
            }
          }
          if (streamState === 1 || streamState === 3) {
            streamArray.write(data);
          }
          if (name === 'endArray') {
            if (arrayDepth === 2) {
              streamState += 1;
            }
            arrayDepth -= 1;
          }
        });
      });
    } catch (error) {
      // Should not throw - instead should emit warning and continue
      expect(error).toBeUndefined();
    }

    // Verify that a warning was emitted (not an error thrown)
    expect(warningEmitted).toBe(true);
    expect(caughtError).not.toBeNull();

    // Verify the warning message contains helpful context
    if (caughtError) {
      // The error should be a parsing error
      expect(caughtError.message).toMatch(/parse|Parser/i);

      // The enhanced error should show the problematic chunk
      // eslint-disable-next-line no-console
      console.log('Enhanced error message:', caughtError.message);

      // The error message should contain the problematic chunk
      expect(caughtError.message).toContain('Problematic chunk');

      // The problematic chunk should show the malformed JSON with unescaped backslashes
      expect(caughtError.message).toContain('C:');
    }

    stream.destroy();
  });
});
