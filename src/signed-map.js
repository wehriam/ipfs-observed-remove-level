// @flow

const ObservedRemoveMap = require('observed-remove-level/dist/signed-map');
const { parser: jsonStreamParser } = require('stream-json/Parser');
const CID = require('cids');
const { default: AbortController } = require('abort-controller');
const { streamArray: jsonStreamArray } = require('stream-json/streamers/StreamArray');
const { default: PQueue } = require('p-queue');
const LruCache = require('lru-cache');
const { debounce } = require('lodash');
const asyncIterableToReadableStream = require('async-iterable-to-readable-stream');

type Options = {
  maxAge?:number,
  bufferPublishing?:number,
  namespace?: string,
  key: any,
  format?: string,
  disableSync?: boolean
};

const notSubscribedRegex = /Not subscribed/;

class IpfsSignedObservedRemoveMap<V> extends ObservedRemoveMap<V> { // eslint-disable-line no-unused-vars
  /**
   * Create an observed-remove CRDT.
   * @param {Object} [ipfs] Object implementing the [core IPFS API](https://github.com/ipfs/interface-ipfs-core#api), most likely a [js-ipfs](https://github.com/ipfs/js-ipfs) or [ipfs-http-client](https://github.com/ipfs/js-ipfs-http-client) object.
   * @param {String} [topic] IPFS pubub topic to use in synchronizing the CRDT.
   * @param {Iterable<V>} [entries=[]] Iterable of initial values
   * @param {Object} [options={}]
   * @param {String} [options.maxAge=5000] Max age of insertion/deletion identifiers
   * @param {String} [options.bufferPublishing=20] Interval by which to buffer 'publish' events
   */
  constructor(db:Object, ipfs:Object, topic:string, entries?: Iterable<[string, V, string, string]>, options?:Options = {}) {
    super(db, entries, options);
    if (!ipfs) {
      throw new Error("Missing required argument 'ipfs'");
    }
    this.db = db;
    this.ipfs = ipfs;
    this.topic = topic;
    this.active = true;
    this.disableSync = !!options.disableSync;
    this.boundHandleQueueMessage = this.handleQueueMessage.bind(this);
    this.boundHandleHashMessage = this.handleHashMessage.bind(this);
    this.readyPromise = this.readyPromise.then(async () => {
      await this.initIpfs();
    });
    this.remoteHashQueue = [];
    this.abortControllers = [];
    this.syncCache = new LruCache(100);
    this.peersCache = new LruCache({
      max: 100,
      maxAge: 1000 * 60,
    });
    this.hasNewPeers = false;
    this.on('set', () => {
      delete this.ipfsHash;
    });
    this.on('delete', () => {
      delete this.ipfsHash;
    });
    this.isLoadingHashes = false;
    this.debouncedIpfsSync = debounce(this.ipfsSync.bind(this), 1000);
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
  declare ipfsHash: string | void;
  declare syncCache: LruCache;
  declare peersCache: LruCache;
  declare hasNewPeers: boolean;
  declare remoteHashQueue: Array<string>;
  declare isLoadingHashes: boolean;
  declare debouncedIpfsSync: () => Promise<void>;
  declare abortControllers: Array<AbortController>;

  async initIpfs() {
    const out = await this.ipfs.id();
    this.ipfsId = out.id;
    this.on('publish', async (queue) => {
      if (!this.active) {
        return;
      }
      try {
        const message = Buffer.from(JSON.stringify(queue));
        await this.ipfs.pubsub.publish(this.topic, message);
      } catch (error) {
        this.emit('error', error);
      }
    });
    const abortController = new AbortController();
    this.abortControllers.push(abortController);
    try {
      await this.ipfs.pubsub.subscribe(this.topic, this.boundHandleQueueMessage, { discover: true, signal: abortController.signal });
      if (!this.disableSync) {
        await this.ipfs.pubsub.subscribe(`${this.topic}:hash`, this.boundHandleHashMessage, { discover: true, signal: abortController.signal });
        this.waitForPeersThenSendHash();
      }
    } catch (error) {
      if (error.type !== 'aborted') {
        throw error;
      }
    }
    this.abortControllers = this.abortControllers.filter((x) => x !== abortController);
  }

  async waitForPeersThenSendHash():Promise<void> {
    if (!this.active) {
      return;
    }
    const abortController = new AbortController();
    this.abortControllers.push(abortController);
    try {
      const peerIds = await this.ipfs.pubsub.peers(this.topic, { timeout: 10000, signal: abortController.signal });
      if (peerIds.length > 0) {
        this.debouncedIpfsSync();
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        setImmediate(() => {
          this.waitForPeersThenSendHash();
        });
      }
    } catch (error) {
      // IPFS connection is closed or timed out, don't send join
      if (error.type !== 'aborted' && error.code !== 'ECONNREFUSED' && error.name !== 'TimeoutError') {
        this.emit('error', error);
      }
      if (this.active && error.name === 'TimeoutError') {
        setImmediate(() => {
          this.waitForPeersThenSendHash();
        });
      }
    }
    this.abortControllers = this.abortControllers.filter((x) => x !== abortController);
  }

  /**
   * Publish an IPFS hash of an array containing all of the object's insertions and deletions.
   * @return {Array<Array<any>>}
   */
  async ipfsSync() {
    if (!this.active) {
      return;
    }
    const abortController = new AbortController();
    this.abortControllers.push(abortController);
    try {
      const hash = await this.getIpfsHash();
      if (!this.active) {
        return;
      }
      if (!this.syncCache.has(hash, true) || this.hasNewPeers) {
        this.hasNewPeers = false;
        this.syncCache.set(hash, true);
        await this.ipfs.pubsub.publish(`${this.topic}:hash`, Buffer.from(hash, 'utf8'), { signal: abortController.signal });
        this.emit('hash', hash);
      }
    } catch (error) {
      if (error.type !== 'aborted') {
        this.emit('error', error);
      }
    }
    this.abortControllers = this.abortControllers.filter((x) => x !== abortController);
  }


  /**
   * Stores and returns an IPFS hash of the current insertions and deletions
   * @return {Promise<string>}
   */
  async getIpfsHash():Promise<string> {
    if (this.ipfsHash) {
      return this.ipfsHash;
    }
    const data = await this.dump();
    const file = await this.ipfs.add(Buffer.from(JSON.stringify(data)), { wrapWithDirectory: false, recursive: false, pin: false });
    this.ipfsHash = file.cid.toString();
    return this.ipfsHash;
  }

  /**
   * Current number of IPFS pubsub peers.
   * @return {number}
   */
  async ipfsPeerCount():Promise<number> {
    const peerIds = await this.ipfs.pubsub.peers(this.topic);
    return peerIds.length;
  }

  /**
   * Gracefully shutdown
   * @return {void}
   */
  async shutdown(): Promise<void> {
    this.active = false;
    for (const abortController of this.abortControllers) {
      abortController.abort();
    }
    // Catch exceptions here as pubsub is sometimes closed by process kill signals.
    if (this.ipfsId) {
      try {
        await this.ipfs.pubsub.unsubscribe(this.topic, this.boundHandleQueueMessage);
      } catch (error) {
        if (!notSubscribedRegex.test(error.message)) {
          throw error;
        }
      }
      if (!this.disableSync) {
        try {
          await this.ipfs.pubsub.unsubscribe(`${this.topic}:hash`, this.boundHandleHashMessage);
        } catch (error) {
          if (!notSubscribedRegex.test(error.message)) {
            throw error;
          }
        }
      }
    }
    await super.shutdown();
  }

  async handleQueueMessage(message:{from:string, data:Buffer}) {
    if (message.from === this.ipfsId) {
      return;
    }
    if (!this.active) {
      return;
    }
    try {
      const queue = JSON.parse(Buffer.from(message.data).toString('utf8'));
      await this.processSigned(queue);
    } catch (error) {
      this.emit('error', error);
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
    this.remoteHashQueue.push(remoteHash);
    this.loadIpfsHashes();
  }

  async loadIpfsHashes() {
    if (this.isLoadingHashes) {
      return;
    }
    this.isLoadingHashes = true;
    try {
      while (this.remoteHashQueue.length > 0 && this.active && this.isLoadingHashes) {
        const remoteHash = this.remoteHashQueue.pop();
        if (this.syncCache.has(remoteHash)) {
          continue;
        }
        this.syncCache.set(remoteHash, true);
        await this.loadIpfsHash(remoteHash);
      }
    } catch (error) {
      this.emit('error', error);
    }
    this.isLoadingHashes = false;
    this.debouncedIpfsSync();
  }

  async loadIpfsHash(hash:string) {
    const processQueue = new PQueue({});
    const stream = asyncIterableToReadableStream(this.ipfs.cat(new CID(hash), { timeout: 30000 }));
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
      processQueue.add(() => this.processSigned([i, d], true));
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
      this.emit('error', error);
      return;
    }
    processQueue.add(() => this.processSigned([insertions, deletions]));
    await processQueue.onIdle();
  }
}


module.exports = IpfsSignedObservedRemoveMap;
