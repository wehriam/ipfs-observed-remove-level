// @flow

import ObservedRemoveMap from 'observed-remove-level/map';
import { parser as jsonStreamParser } from 'stream-json/Parser';
import CID from 'cids';
import { streamArray as jsonStreamArray } from 'stream-json/streamers/StreamArray';
import { hash32 } from 'farmhash';
import PQueue from 'p-queue';
import LruCache from 'lru-cache';
import { Readable } from 'stream';
import debounce from 'lodash/debounce';
import {
  SerializeTransform,
  DeserializeTransform,
} from '@bunchtogether/chunked-stream-transformers';
import ReadableJsonDump from './readable-json-dump';


type Options = {
  maxAge?:number,
  bufferPublishing?:number,
  namespace?: string,
  format?: string,
  disableSync?: boolean,
  chunkPubSub?: boolean
};

const notSubscribedRegex = /Not subscribed/;

const OPEN_BUFFER = Buffer.from('["');
const MID_BUFFER = Buffer.from('",');
const CLOSE_BUFFER = Buffer.from(']');
const COMMA_BUFFER = Buffer.from(',');

export default class IpfsObservedRemoveMap<V> extends ObservedRemoveMap<V> { // eslint-disable-line no-unused-vars
  /**
   * Create an observed-remove CRDT.
   * @param {Object} [ipfs] Object implementing the [core IPFS API](https://github.com/ipfs/interface-ipfs-core#api), most likely a [js-ipfs](https://github.com/ipfs/js-ipfs) or [ipfs-http-client](https://github.com/ipfs/js-ipfs-http-client) object.
   * @param {String} [topic] IPFS pubub topic to use in synchronizing the CRDT.
   * @param {Iterable<V>} [entries=[]] Iterable of initial values
   * @param {Object} [options={}]
   * @param {String} [options.maxAge=5000] Max age of insertion/deletion identifiers
   * @param {String} [options.bufferPublishing=20] Interval by which to buffer 'publish' events
   * @param {boolean} [options.chunkPubSub=false] Chunk pubsub messages for values greater than 1 MB
   */
  constructor(db:Object, ipfs:Object, topic:string, entries?: Iterable<[string, V]>, options?:Options = {}) {
    super(db, entries, options);
    if (!ipfs) {
      throw new Error("Missing required argument 'ipfs'");
    }
    this.chunkPubSub = !!options.chunkPubSub;
    this.db = db;
    this.ipfs = ipfs;
    this.abortController = new AbortController();
    this.topic = topic;
    this.active = true;
    this.disableSync = !!options.disableSync;
    this.boundHandleQueueMessage = this.handleQueueMessage.bind(this);
    this.boundHandleHashMessage = this.handleHashMessage.bind(this);
    this.readyPromise = this.readyPromise.then(async () => {
      await this.initIpfs();
    });
    this.syncCache = new LruCache(100);
    this.peersCache = new LruCache({
      max: 100,
      maxAge: 1000 * 60 * 60,
    });
    this.hasNewPeers = false;
    this.on('set', () => {
      delete this.ipfsHashes;
      delete this.ipfsHash;
    });
    this.on('delete', () => {
      delete this.ipfsHashes;
      delete this.ipfsHash;
    });
    this.debouncedIpfsSync = debounce(this.ipfsSync.bind(this), 1000);
    this.serializeTransform = new SerializeTransform({
      autoDestroy: false,
      maxChunkSize: 1024 * 512,
    });
    this.serializeTransform.on('data', async (messageSlice) => {
      if (!this.active) {
        return;
      }
      const { controller, cleanup } = this.createLinkedAbortController();
      try {
        await this.ipfs.pubsub.publish(this.topic, messageSlice, { signal: controller.signal });
      } catch (error) {
        if (error.type !== 'aborted') {
          this.emit('error', error);
        }
      } finally {
        cleanup();
      }
    });
    this.serializeTransform.on('error', (error) => {
      this.emit('error', error);
    });
    this.deserializeTransform = new DeserializeTransform({
      autoDestroy: false,
      timeout: 10000,
    });
    this.deserializeTransform.on('error', (error) => {
      this.emit('error', error);
    });
    this.deserializeTransform.on('data', async (message) => {
      try {
        const queue = JSON.parse(message.toString('utf8'));
        await this.process(queue);
      } catch (error) {
        this.emit('error', error);
      }
    });
    this.hashLoadQueue = new PQueue({});
    this.hashLoadQueue.on('idle', async () => {
      if (this.hasNewPeers && this.active) {
        this.debouncedIpfsSync();
      }
      this.emit('hashesloaded');
    });
  }

  /**
   * Resolves when IPFS topic subscriptions are confirmed.
   *
   * @name IpfsObservedRemoveSet#readyPromise
   * @type {Promise<void>}
   * @readonly
   */

  declare ipfs: Object;
  declare topic: string;
  declare readyPromise: Promise<void>;
  declare active: boolean;
  declare ipfsId: string;
  declare disableSync: boolean;
  declare boundHandleQueueMessage: (message:{from:string, data:Buffer}) => Promise<void>;
  declare boundHandleHashMessage: (message:{from:string, data:Buffer}) => Promise<void>;
  declare db: Object;
  declare ipfsHashes: Array<string> | void;
  declare ipfsHash: string | void;
  declare syncCache: LruCache;
  declare peersCache: LruCache;
  declare hasNewPeers: boolean;
  declare debouncedIpfsSync: () => Promise<void>;
  declare abortController: AbortController;
  declare chunkPubSub: boolean;
  declare serializeTransform: SerializeTransform;
  declare deserializeTransform: DeserializeTransform;
  declare hashLoadQueue: PQueue;

  /**
   * Create a per-operation abort controller linked to the main abort controller.
   * This prevents listener accumulation in any-signal when combining signals.
   * @private
   * @returns {{controller: AbortController, cleanup: Function}}
   */
  createLinkedAbortController(): { controller: AbortController, cleanup: () => void } {
    const controller = new AbortController();
    let cleanup = () => {};

    if (this.abortController.signal.aborted) {
      controller.abort();
    } else {
      const handler = () => controller.abort();
      this.abortController.signal.addEventListener('abort', handler);
      cleanup = () => {
        this.abortController.signal.removeEventListener('abort', handler);
      };
    }

    return { controller, cleanup };
  }

  async initIpfs() {
    try {
      const { id } = await this.ipfs.id({ signal: this.abortController.signal });
      this.ipfsId = id;
    } catch (error) {
      if (error.type !== 'aborted') {
        throw error;
      }
      return;
    }
    this.on('publish', async (queue) => {
      if (!this.active) {
        return;
      }
      if (this.chunkPubSub) {
        const message = Buffer.from(JSON.stringify(queue));
        this.serializeTransform.write(message);
      } else {
        const { controller, cleanup } = this.createLinkedAbortController();
        try {
          const message = Buffer.from(JSON.stringify(queue));
          await this.ipfs.pubsub.publish(this.topic, message, { signal: controller.signal });
        } catch (error) {
          if (error.type !== 'aborted') {
            this.emit('error', error);
          }
        } finally {
          cleanup();
        }
      }
    });
    try {
      await this.ipfs.pubsub.subscribe(this.topic, this.boundHandleQueueMessage, { signal: this.abortController.signal });
      if (!this.disableSync) {
        await this.ipfs.pubsub.subscribe(`${this.topic}:hash`, this.boundHandleHashMessage, { signal: this.abortController.signal });
        this.waitForPeersThenSendHash();
      }
    } catch (error) {
      if (error.type !== 'aborted') {
        throw error;
      }
    }
  }

  async waitForPeers():Promise<void> {
    while (true) {
      try {
        const peerIds = await this.ipfs.pubsub.peers(this.topic, { timeout: 10000, signal: this.abortController.signal });
        if (this.abortController.signal.aborted) {
          return;
        }
        if (peerIds.length > 0) {
          break;
        }
      } catch (error) {
        if (error.name === 'TimeoutError') {
          continue;
        }
        throw error;
      }
    }
    while (true) {
      try {
        const peerIds = await this.ipfs.pubsub.peers(`${this.topic}:hash`, { timeout: 10000, signal: this.abortController.signal });
        if (this.abortController.signal.aborted) {
          return;
        }
        if (peerIds.length > 0) {
          break;
        }
      } catch (error) {
        if (error.name === 'TimeoutError') {
          continue;
        }
        throw error;
      }
    }
  }

  async waitForPeersThenSendHash():Promise<void> {
    if (!this.active) {
      return;
    }
    try {
      const peerIds = await this.ipfs.pubsub.peers(this.topic, { timeout: 10000, signal: this.abortController.signal });
      if (this.abortController.signal.aborted) {
        return;
      }
      if (peerIds.length > 0) {
        this.debouncedIpfsSync();
      } else {
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            this.abortController.signal.removeEventListener('abort', handleAbort);
            resolve();
          }, 10000);
          const handleAbort = () => {
            clearTimeout(timeout);
            this.abortController.signal.removeEventListener('abort', handleAbort);
            resolve();
          };
          this.abortController.signal.addEventListener('abort', handleAbort);
        });
        queueMicrotask(() => {
          this.waitForPeersThenSendHash();
        });
      }
    } catch (error) {
      // IPFS connection is closed or timed out, don't send join
      if (error.type !== 'aborted' && error.code !== 'ECONNREFUSED' && error.name !== 'TimeoutError') {
        this.emit('error', error);
      }
      if (this.active && error.name === 'TimeoutError') {
        queueMicrotask(() => {
          this.waitForPeersThenSendHash();
        });
      }
    }
  }

  /**
   * Publish an IPFS hash of an array containing all of the object's insertions and deletions.
   * @return {Array<Array<any>>}
   */
  async ipfsSync() {
    if (!this.active) {
      return;
    }
    try {
      const hashes = await this.getIpfsHashes();
      for (const hash of hashes) {
        if (!this.active) {
          return;
        }
        if (!this.syncCache.has(hash) || this.hasNewPeers) {
          this.syncCache.set(hash, true);
          const { controller, cleanup } = this.createLinkedAbortController();
          try {
            await this.ipfs.pubsub.publish(`${this.topic}:hash`, Buffer.from(hash, 'utf8'), { signal: controller.signal });
            this.emit('hash', hash);
          } finally {
            cleanup();
          }
        }
      }
      this.hasNewPeers = false;
    } catch (error) {
      if (error.type !== 'aborted') {
        this.emit('error', error);
      }
    }
  }

  /**
   * Stores and returns an IPFS hash of the current insertions and deletions
   * @return {Promise<string>}
   */
  async getIpfsHash():Promise<string> {
    if (this.ipfsHash) {
      return this.ipfsHash;
    }
    const stream = new ReadableJsonDump(this.db.db.db, this.namespace);
    const file = await this.ipfs.add(stream, { wrapWithDirectory: false, recursive: false, pin: false, signal: this.abortController.signal });
    this.ipfsHash = file.cid.toString();
    return this.ipfsHash;
  }

  /**
   * Stores and returns an IPFS hash of the current insertions and deletions
   * @return {Promise<string>}
   */
  async getIpfsHashes():Promise<Array<string>> {
    if (this.ipfsHashes) {
      return this.ipfsHashes;
    }
    const namespaceLength = Buffer.from(`${this.namespace}>`).length;
    const isAdded = [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ];
    const isFirstInsertion = [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ];
    const isFirstDeletion = [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ];
    const streams = [
      new Readable({ read() {}, signal: this.abortController.signal }),
      new Readable({ read() {}, signal: this.abortController.signal }),
      new Readable({ read() {}, signal: this.abortController.signal }),
      new Readable({ read() {}, signal: this.abortController.signal }),
      new Readable({ read() {}, signal: this.abortController.signal }),
      new Readable({ read() {}, signal: this.abortController.signal }),
      new Readable({ read() {}, signal: this.abortController.signal }),
      new Readable({ read() {}, signal: this.abortController.signal }),
    ];
    const addPromises = [];
    for (const stream of streams) {
      stream.push(Buffer.from('[['));
    }
    for await (const [namespaceWithKey, pair] of this.db.db.db.iterator({ gt: `${this.namespace}>`, lt: `${this.namespace}?`, keyAsBuffer: true, valueAsBuffer: true })) {
      const key = namespaceWithKey.slice(namespaceLength);
      const streamId = hash32(key) % 8;
      const stream = streams[streamId];
      if (!isAdded[streamId]) {
        isAdded[streamId] = true;
        addPromises.push(this.ipfs.add(stream, { wrapWithDirectory: false, recursive: false, pin: false, signal: this.abortController.signal }));
      }
      if (isFirstInsertion[streamId]) {
        isFirstInsertion[streamId] = false;
      } else {
        stream.push(COMMA_BUFFER);
      }
      stream.push(OPEN_BUFFER);
      stream.push(key);
      stream.push(MID_BUFFER);
      stream.push(pair);
      stream.push(CLOSE_BUFFER);
    }
    for (const stream of streams) {
      stream.push(Buffer.from('],['));
    }
    for await (const [namespaceWithId, key] of this.db.db.db.iterator({ gt: `${this.namespace}<`, lt: `${this.namespace}=`, keyAsBuffer: true, valueAsBuffer: true })) {
      const id = namespaceWithId.slice(namespaceLength);
      const streamId = hash32(key) % 8;
      const stream = streams[streamId];
      if (!isAdded[streamId]) {
        isAdded[streamId] = true;
        addPromises.push(this.ipfs.add(stream, { wrapWithDirectory: false, recursive: false, pin: false, signal: this.abortController.signal }));
      }
      if (isFirstDeletion[streamId]) {
        isFirstDeletion[streamId] = false;
      } else {
        stream.push(COMMA_BUFFER);
      }
      stream.push(OPEN_BUFFER);
      stream.push(id);
      stream.push(MID_BUFFER);
      stream.push(key);
      stream.push(CLOSE_BUFFER);
    }
    for (const stream of streams) {
      stream.push(Buffer.from(']]'));
    }
    for (const stream of streams) {
      stream.push(null);
    }
    const hashes = (await Promise.all(addPromises)).map(({ cid }) => cid.toString());
    this.ipfsHashes = hashes;
    return hashes;
  }


  //  /**
  //   * Stores and returns an IPFS hash of the current insertions and deletions
  //   * @return {Promise<string>}
  //   */
  //  async getIpfsHashes():Promise<Array<string>> {
  //    if (this.ipfsHashes) {
  //      return this.ipfsHashes;
  //    }
  //    const start = Date.now();
  //    const ipfsHashes = [];
  //    for (let i = 0; i < 8; i += 1) {
  //      const stream = new ReadableJsonDump(this.db.db.db, this.namespace, { buckets: 8, bucket: i });
  //      const file = await this.ipfs.add(stream, { wrapWithDirectory: false, recursive: false, pin: false, signal: this.abortController.signal });
  //      ipfsHashes.push(file.cid.toString());
  //      if (!this.active) {
  //        break;
  //      }
  //    }
  //    console.log('DUMP', Date.now() - start, this.ipfsId);
  //    console.log(ipfsHashes)
  //    this.ipfsHashes = ipfsHashes;
  //    return ipfsHashes;
  //  }

  /**
   * Current number of IPFS pubsub peers.
   * @return {number}
   */
  async ipfsPeerCount():Promise<number> {
    const peerIds = await this.ipfs.pubsub.peers(this.topic, { signal: this.abortController.signal });
    return peerIds.length;
  }

  /**
   * Gracefully shutdown
   * @return {void}
   */
  async shutdown(): Promise<void> {
    this.active = false;
    // Catch exceptions here as pubsub is sometimes closed by process kill signals.
    if (this.ipfsId) {
      try {
        const unsubscribeAbortController = new AbortController();
        const timeout = setTimeout(() => {
          unsubscribeAbortController.abort();
        }, 5000);
        await this.ipfs.pubsub.unsubscribe(this.topic, this.boundHandleQueueMessage, { signal: unsubscribeAbortController.signal });
        if (!this.disableSync) {
          await this.ipfs.pubsub.unsubscribe(`${this.topic}:hash`, this.boundHandleHashMessage, { signal: unsubscribeAbortController.signal });
        }
        clearTimeout(timeout);
      } catch (error) {
        if (!notSubscribedRegex.test(error.message)) {
          this.abortController.abort();
          this.abortController = new AbortController();
          throw error;
        }
      }
    }
    await this.hashLoadQueue.onIdle();
    this.abortController.abort();
    this.abortController = new AbortController();
    await this.deserializeTransform.onIdle();
    this.serializeTransform.destroy();
    this.deserializeTransform.destroy();
    await super.shutdown();
  }

  async handleQueueMessage(message:{from:string, data:Buffer}) {
    if (message.from === this.ipfsId) {
      return;
    }
    if (!this.active) {
      return;
    }
    if (this.chunkPubSub) {
      this.deserializeTransform.write(message.data);
    } else {
      try {
        const queue = JSON.parse(Buffer.from(message.data).toString('utf8'));
        await this.process(queue);
      } catch (error) {
        this.emit('error', error);
      }
    }
  }

  handleHashMessage(message:{from:string, data:Buffer}) {
    if (!this.active) {
      return;
    }
    if (message.from === this.ipfsId) {
      return;
    }
    if (!this.peersCache.has(message.from)) {
      this.hasNewPeers = true;
      this.peersCache.set(message.from, true);
    }
    const remoteHash = Buffer.from(message.data).toString('utf8');
    if (this.syncCache.has(remoteHash)) {
      return;
    }
    this.syncCache.set(remoteHash, true);
    try {
      this.hashLoadQueue.add(() => this.loadIpfsHash(remoteHash));
    } catch (error) {
      this.emit('error', error);
    }
  }

  async loadIpfsHash(hash:string) {
    // $FlowFixMe
    const stream = Readable.from(this.ipfs.cat(new CID(hash), { timeout: 120000 }));
    const parser = jsonStreamParser();
    const streamArray = jsonStreamArray();
    const pipeline = stream.pipe(parser);
    let arrayDepth = 0;
    let streamState = 0;
    let insertions = [];
    let deletions = [];
    streamArray.on('data', ({ value }) => {
      if (streamState === 1) {
        insertions.push(value);
      } else if (streamState === 3) {
        deletions.push(value);
      }
      if (insertions.length + deletions.length < 1000) {
        return;
      }
      const i = insertions;
      const d = deletions;
      insertions = [];
      deletions = [];
      this.process([i, d], true);
    });
    try {
      await new Promise((resolve, reject) => {
        stream.on('error', (error) => {
          reject(error);
        });
        streamArray.on('error', (error) => {
          reject(error);
        });
        pipeline.on('error', (error) => {
          reject(error);
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
      if (error.type !== 'aborted') {
        this.emit('error', error);
      }
      return;
    }
    stream.destroy();
    this.process([insertions, deletions]);
    await this.processQueue.onIdle();
  }
}
