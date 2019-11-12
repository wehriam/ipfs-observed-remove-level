//      

const { inflate, deflate } = require('pako');
const { Readable } = require('stream');
const ObservedRemoveMap = require('observed-remove-level/dist/map');
const stringify = require('json-stringify-deterministic');
const { parser: jsonStreamParser } = require('stream-json/Parser');
const { streamArray: jsonStreamArray } = require('stream-json/streamers/StreamArray');
const { default: PQueue } = require('p-queue');

                
                 
                           
            
                  
                       
  

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
   */
  constructor(db       , ipfs       , topic       , entries                        , options          = {}) {
    super(db, entries, options);
    this.db = db;
    this.ipfs = ipfs;
    this.topic = topic;
    this.active = true;
    this.disableSync = !!options.disableSync;
    this.boundHandleQueueMessage = this.handleQueueMessage.bind(this);
    this.boundHandleHashMessage = this.handleHashMessage.bind(this);
    this.boundHandleJoinMessage = this.handleJoinMessage.bind(this);
    this.readyPromise = this.init();
    this.syncQueue = new PQueue({ concurrency: 1 });
    this.remoteHashes = new Set();
  }

  /**
   * Resolves when IPFS topic subscriptions are confirmed.
   *
   * @name IpfsObservedRemoveSet#readyPromise
   * @type {Promise<void>}
   * @readonly
   */

               
                
                              
                  
                 
                       
                                                                                 
                                                                                
                                                                                
             
                      
                    
                                           
                                        
                            

  async process(queue                     , skipFlush           = false) {
    delete this.hash;
    await super.process(queue, skipFlush);
  }

  async init()               {
    this.ipfsId = (await this.ipfs.id()).id;
    this.on('publish', async (queue) => {
      if (!this.active) {
        return;
      }
      try {
        const message = Buffer.from(deflate(stringify(queue)));
        await this.ipfs.pubsub.publish(this.topic, message);
      } catch (error) {
        this.emit('error', error);
      }
    });
    await this.ipfs.pubsub.subscribe(this.topic, this.boundHandleQueueMessage, { discover: true });
    if (!this.disableSync) {
      await this.ipfs.pubsub.subscribe(`${this.topic}:hash`, this.boundHandleHashMessage, { discover: true });
      await this.ipfs.pubsub.subscribe(`${this.topic}:join`, this.boundHandleJoinMessage, { discover: true });
      this.sendJoinMessage();
    }
  }

  async sendJoinMessage()               {
    try {
      const peerIds = await this.waitForIpfsPeers();
      if (peerIds.length === 0) {
        return;
      }
      await this.ipfs.pubsub.publish(`${this.topic}:join`, Buffer.from(this.ipfsId, 'utf8'));
    } catch (error) {
      // IPFS connection is closed, don't send join
      if (error.code !== 'ECONNREFUSED') {
        this.emit('error', error);
      }
    }
  }

  /**
   * Publish an IPFS hash of an array containing all of the object's insertions and deletions.
   * @return {Array<Array<any>>}
   */
  ipfsSync()      {
    if (this.syncMessagePromise) {
      return;
    }
    this.syncMessagePromise = this.syncQueue.add(async () => {
      if (!this.active) {
        delete this.syncMessagePromise;
        return;
      }
      try {
        const message = await this.getIpfsHash();
        await this.ipfs.pubsub.publish(`${this.topic}:hash`, Buffer.from(message, 'utf8'));
      } catch (error) {
        this.emit('error', error);
      }
      delete this.syncMessagePromise;
    }, { priority: 0 }).catch((error) => {
      this.emit('error', error);
      delete this.syncMessagePromise;
    });
  }

  /**
   * Stores and returns an IPFS hash of the current insertions and deletions
   * @return {Promise<string>}
   */
  async getIpfsHash()                 {
    if (this.hash) {
      return this.hash;
    }
    await this.flush();
    const length = Buffer.from(`${this.namespace}>`).length;
    const openBuffer = Buffer.from('["');
    const midBuffer = Buffer.from('",');
    const closeBuffer = Buffer.from(']');
    const commaBuffer = Buffer.from(',');
    const pairIterator = this.db.db.db.iterator({
      gt: Buffer.from(`${this.namespace}>`),
      lt: Buffer.from(`${this.namespace}?`),
      keyAsBuffer: true,
      valueAsBuffer: true,
    });
    const deletionIterator = this.db.db.db.iterator({
      gt: Buffer.from(`${this.namespace}<`),
      lt: Buffer.from(`${this.namespace}=`),
      keyAsBuffer: true,
      valueAsBuffer: true,
    });
    let isReading = false;
    let didWritePairs = false;
    let didWriteDeletions = false;
    let skipPairComma = true;
    let skipDeletionComma = true;
    const stream = new Readable({
      async read() {
        if (isReading) {
          return;
        }
        isReading = true;
        if (!didWritePairs) {
          const getKeyPair = (resolve) => {
            pairIterator.next((error             , k               , v               ) => {
              if (error) {
                didWritePairs = true;
                didWriteDeletions = true;
                process.nextTick(() => this.emit('error', error));
                resolve([undefined, undefined]);
              } else {
                resolve([k, v]);
              }
            });
          };
          while (true) {
            const [key, pair] = await new Promise(getKeyPair);
            if (key && pair) {
              let buffer;
              if (skipPairComma) {
                skipPairComma = false;
                buffer = Buffer.concat([openBuffer, key.slice(length), midBuffer, pair, closeBuffer]);
              } else {
                buffer = Buffer.concat([commaBuffer, openBuffer, key.slice(length), midBuffer, pair, closeBuffer]);
              }
              const shouldKeepPushing = this.push(buffer);
              if (!shouldKeepPushing) {
                return;
              }
            } else {
              break;
            }
          }
          this.push(Buffer.from('],['));
          didWritePairs = true;
          await new Promise((resolve, reject) => {
            pairIterator.end((error             ) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          });
        }
        if (!didWriteDeletions) {
          const getKeyPair = (resolve) => {
            deletionIterator.next((error             , k               , v               ) => {
              if (error) {
                didWritePairs = true;
                didWriteDeletions = true;
                process.nextTick(() => this.emit('error', error));
                resolve([undefined, undefined]);
              } else {
                resolve([k, v]);
              }
            });
          };
          while (true) {
            const [id, key] = await new Promise(getKeyPair);
            if (id && key) {
              let buffer;
              if (skipDeletionComma) {
                skipDeletionComma = false;
                buffer = Buffer.concat([openBuffer, id.slice(length), midBuffer, key, closeBuffer]);
              } else {
                buffer = Buffer.concat([commaBuffer, openBuffer, id.slice(length), midBuffer, key, closeBuffer]);
              }
              const shouldKeepPushing = this.push(buffer);
              if (!shouldKeepPushing) {
                return;
              }
            } else {
              break;
            }
          }
          didWriteDeletions = true;
          await new Promise((resolve, reject) => {
            deletionIterator.end((error             ) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          });
        }
        this.push(Buffer.from(']]'));
        this.push(null);
        isReading = false;
      },
    });
    stream.push(Buffer.from('[['));
    const resultPromise = this.ipfs.addFromStream(stream, { wrapWithDirectory: false, recursive: false, pin: false });
    const result = await resultPromise;
    this.hash = result[0].hash;
    return this.hash;
  }

  /**
   * Resolves an array of peer ids after one or more IPFS peers connects. Useful for testing.
   * @return {Promise<void>}
   */
  async waitForIpfsPeers()                        {
    let peerIds = await this.ipfs.pubsub.peers(this.topic);
    while (this.active && peerIds.length === 0) {
      peerIds = await this.ipfs.pubsub.peers(this.topic);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return peerIds;
  }

  /**
   * Current number of IPFS pubsub peers.
   * @return {number}
   */
  async ipfsPeerCount()                 {
    const peerIds = await this.ipfs.pubsub.peers(this.topic);
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
        try {
          await this.ipfs.pubsub.unsubscribe(`${this.topic}:join`, this.boundHandleJoinMessage);
        } catch (error) {
          if (!notSubscribedRegex.test(error.message)) {
            throw error;
          }
        }
      }
    }
    await this.syncQueue.onIdle();
  }

  async handleQueueMessage(message                           ) {
    if (message.from === this.ipfsId) {
      return;
    }
    this.syncQueue.add(async () => {
      if (!this.active) {
        return;
      }
      try {
        const queue = JSON.parse(Buffer.from(inflate(message.data)).toString('utf8'));
        await this.process(queue);
      } catch (error) {
        this.emit('error', error);
      }
    }, { priority: 2 }); // eslint-disable-line no-underscore-dangle
  }

  async handleHashMessage(message                           ) {
    if (!this.active) {
      return;
    }
    if (message.from === this.ipfsId) {
      return;
    }
    this.remoteHashes.add(message.data.toString('utf8'));
    if (this.syncHashPromise) {
      return;
    }
    this.syncHashPromise = this.syncQueue.add(async () => {
      try {
        const beforeHash = await this.getIpfsHash();
        delete this.syncHashPromise;
        const remoteHashes = this.remoteHashes;
        this.remoteHashes = new Set();
        const loadIpfsHashPromises = [];
        for (const remoteHash of remoteHashes) {
          if (remoteHash === beforeHash) {
            continue;
          }
          loadIpfsHashPromises.push(this.loadIpfsHash(remoteHash));
        }
        if (loadIpfsHashPromises.length === 0) {
          return;
        }
        await Promise.all(loadIpfsHashPromises);
        const afterHash = await this.getIpfsHash();
        if (!this.active) {
          return;
        }
        if (beforeHash !== afterHash) {
          return;
        }
        let shouldSendHash = false;
        for (const remoteHash of remoteHashes) {
          if (afterHash !== remoteHash) {
            shouldSendHash = true;
            break;
          }
        }
        if (shouldSendHash) {
          this.ipfsSync();
        }
      } catch (error) {
        delete this.syncHashPromise;
        this.emit('error', error);
      }
    }, { priority: 1 }).catch((error) => {
      delete this.syncHashPromise;
      this.emit('error', error);
    });
  }

  async loadIpfsHash(hash       ) {
    const processQueue = new PQueue({ concurrency: 1 });
    const stream = this.ipfs.catReadableStream(hash);
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
    processQueue.add(() => this.process([insertions, deletions]));
    await processQueue.onIdle();
  }

  async handleJoinMessage(message                           ) {
    if (!this.active) {
      return;
    }
    if (message.from === this.ipfsId) {
      return;
    }
    await this.ipfsSync();
  }
}


module.exports = IpfsObservedRemoveMap;
