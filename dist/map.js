//      

const ObservedRemoveMap = require('observed-remove-level/dist/map');
const { parser: jsonStreamParser } = require('stream-json/Parser');
const CID = require('cids');
const { default: AbortController } = require('abort-controller');
const { streamArray: jsonStreamArray } = require('stream-json/streamers/StreamArray');
const { default: PQueue } = require('p-queue');
const ReadableJsonDump = require('./readable-json-dump');
const LruCache = require('lru-cache');
const { debounce } = require('lodash');
const asyncIterableToReadableStream = require('async-iterable-to-readable-stream');
const {
  SerializeTransform,
  DeserializeTransform,
} = require('@bunchtogether/chunked-stream-transformers');

                
                 
                           
                     
                  
                        
                       
  

const notSubscribedRegex = /Not subscribed/;

class IpfsObservedRemoveMap    extends ObservedRemoveMap    { // eslint-disable-line no-unused-vars
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
  constructor(db       , ipfs       , topic       , entries                        , options          = {}) {
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
    this.remoteHashQueue = [];
    this.syncCache = new LruCache(100);
    this.peersCache = new LruCache({
      max: 100,
      maxAge: 1000 * 60 * 60,
    });
    this.hasNewPeers = false;
    this.on('set', () => {
      delete this.ipfsHashes;
    });
    this.on('delete', () => {
      delete this.ipfsHashes;
    });
    this.isLoadingHashes = false;
    this.debouncedIpfsSync = debounce(this.ipfsSync.bind(this), 1000);
    this.serializeTransform = new SerializeTransform({
      autoDestroy: false,
      maxChunkSize: 1024 * 512,
    });
    this.serializeTransform.on('data', async (messageSlice) => {
      try {
        await this.ipfs.pubsub.publish(this.topic, messageSlice, { signal: this.abortController.signal });
      } catch (error) {
        if (error.type !== 'aborted') {
          this.emit('error', error);
        }
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
  }

  /**
   * Resolves when IPFS topic subscriptions are confirmed.
   *
   * @name IpfsObservedRemoveSet#readyPromise
   * @type {Promise<void>}
   * @readonly
   */

                       
                        
                                      
                          
                         
                               
                                                                                         
                                                                                        
                     
                                           
                              
                               
                               
                                         
                                   
                                                 
                                           
                               
                                                 
                                                     

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
        try {
          const message = Buffer.from(JSON.stringify(queue));
          await this.ipfs.pubsub.publish(this.topic, message, { signal: this.abortController.signal });
        } catch (error) {
          if (error.type !== 'aborted') {
            this.emit('error', error);
          }
        }
      }
    });
    try {
      const promises = [this.ipfs.pubsub.subscribe(this.topic, this.boundHandleQueueMessage, { discover: true, signal: this.abortController.signal })];
      if (!this.disableSync) {
        promises.push(this.ipfs.pubsub.subscribe(`${this.topic}:hash`, this.boundHandleHashMessage, { discover: true, signal: this.abortController.signal }));
        this.waitForPeersThenSendHash();
      }
      await Promise.all(promises);
    } catch (error) {
      if (error.type !== 'aborted') {
        throw error;
      }
    }
  }

  async waitForPeersThenSendHash()               {
    if (!this.active) {
      return;
    }
    try {
      const peerIds = await this.ipfs.pubsub.peers(this.topic, { timeout: 10000, signal: this.abortController.signal });
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
      if (!this.active) {
        return;
      }
      for (const hash of hashes) {
        if (!this.syncCache.has(hash) || this.hasNewPeers) {
          this.hasNewPeers = false;
          this.syncCache.set(hash, true);
          await this.ipfs.pubsub.publish(`${this.topic}:hash`, Buffer.from(hash, 'utf8'), { signal: this.abortController.signal });
          this.emit('hash', hash);
        }
      }
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
  async getIpfsHash()                        {
    const stream = new ReadableJsonDump(this.db.db.db, this.namespace);
    const file = await this.ipfs.add(stream, { wrapWithDirectory: false, recursive: false, pin: false, signal: this.abortController.signal });
    return file.cid.toString();
  }

  /**
   * Stores and returns an IPFS hash of the current insertions and deletions
   * @return {Promise<string>}
   */
  async getIpfsHashes()                        {
    if (this.ipfsHashes) {
      return this.ipfsHashes;
    }
    const ipfsHashes = [];
    for (let i = 0; i < 8; i += 1) {
      const stream = new ReadableJsonDump(this.db.db.db, this.namespace, { buckets: 8, bucket: i });
      const file = await this.ipfs.add(stream, { wrapWithDirectory: false, recursive: false, pin: false, signal: this.abortController.signal });
      ipfsHashes.push(file.cid.toString());
      if (!this.active) {
        break;
      }
    }
    this.ipfsHashes = ipfsHashes;
    return ipfsHashes;
  }

  /**
   * Current number of IPFS pubsub peers.
   * @return {number}
   */
  async ipfsPeerCount()                 {
    const peerIds = await this.ipfs.pubsub.peers(this.topic, { signal: this.abortController.signal });
    return peerIds.length;
  }

  /**
   * Gracefully shutdown
   * @return {void}
   */
  async shutdown()                {
    this.active = false;
    // Catch exceptions here as pubsub is sometimes closed by process kill signals.
    if (this.ipfsId) {
      try {
        const unsubscribeAbortController = new AbortController();
        const timeout = setTimeout(() => {
          unsubscribeAbortController.abort();
        }, 5000);
        const promises = [this.ipfs.pubsub.unsubscribe(this.topic, this.boundHandleQueueMessage, { signal: unsubscribeAbortController.signal })];
        if (!this.disableSync) {
          promises.push(this.ipfs.pubsub.unsubscribe(`${this.topic}:hash`, this.boundHandleHashMessage, { signal: unsubscribeAbortController.signal }));
        }
        await Promise.all(promises);
        clearTimeout(timeout);
      } catch (error) {
        if (!notSubscribedRegex.test(error.message)) {
          this.abortController.abort();
          this.abortController = new AbortController();
          throw error;
        }
      }
    }
    this.abortController.abort();
    this.abortController = new AbortController();
    await this.deserializeTransform.onIdle();
    this.serializeTransform.destroy();
    this.deserializeTransform.destroy();
    await super.shutdown();
  }

  async handleQueueMessage(message                           ) {
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

  handleHashMessage(message                           ) {
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
    if (this.hasNewPeers) {
      this.debouncedIpfsSync();
    }
  }

  async loadIpfsHash(hash       ) {
    const processQueue = new PQueue({});
    const stream = asyncIterableToReadableStream(this.ipfs.cat(new CID(hash), { timeout: 120000 }));
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
      processQueue.add(() => this.process([i, d], true));
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
    processQueue.add(() => this.process([insertions, deletions]));
    await processQueue.onIdle();
  }
}


module.exports = IpfsObservedRemoveMap;
