// @flow

const { Readable } = require('stream');

const OPEN_BUFFER = Buffer.from('["');
const MID_BUFFER = Buffer.from('",');
const CLOSE_BUFFER = Buffer.from(']');
const COMMA_BUFFER = Buffer.from(',');

type LevelDBIterator = {next: ((Error | void, Buffer | void, Buffer | void) => void) => void, end: ((Error | void) => void) => void};

class ReadableJsonDump extends Readable {
  constructor(db:Object, namespace: string, options?:Object) {
    super(options);
    this.push(Buffer.from('[['));
    this.insertionIterator = db.iterator({
      gt: Buffer.from(`${namespace}>`),
      lt: Buffer.from(`${namespace}?`),
      keyAsBuffer: true,
      valueAsBuffer: true,
    });
    this.deletionIterator = db.iterator({
      gt: Buffer.from(`${namespace}<`),
      lt: Buffer.from(`${namespace}=`),
      keyAsBuffer: true,
      valueAsBuffer: true,
    });
    this.didWritePairs = false;
    this.didWriteDeletions = false;
    this.isReading = false;
    this.skipInsertionComma = true;
    this.skipDeletionComma = true;
    this.namespaceLength = Buffer.from(`${namespace}>`).length;
  }

  declare namespaceLength: number;
  declare insertionIterator: LevelDBIterator;
  declare deletionIterator: LevelDBIterator;
  declare didWritePairs: boolean;
  declare didWriteDeletions: boolean;
  declare skipInsertionComma: boolean;
  declare skipDeletionComma: boolean;
  declare isReading: boolean;

  getInsertionPair():Promise<[Buffer | void, Buffer | void]> {
    return new Promise((resolve) => {
      this.insertionIterator.next((error:Error | void, k: Buffer | void, v: Buffer | void) => {
        if (error) {
          this.didWritePairs = true;
          this.didWriteDeletions = true;
          process.nextTick(() => this.emit('error', error));
          resolve([undefined, undefined]);
        } else {
          resolve([k, v]);
        }
      });
    });
  }

  getDeletionPair():Promise<[Buffer | void, Buffer | void]> {
    return new Promise((resolve) => {
      this.deletionIterator.next((error:Error | void, k: Buffer | void, v: Buffer | void) => {
        if (error) {
          this.didWritePairs = true;
          this.didWriteDeletions = true;
          process.nextTick(() => this.emit('error', error));
          resolve([undefined, undefined]);
        } else {
          resolve([k, v]);
        }
      });
    });
  }

  async readFromLevelDbIterators() {
    if (this.isReading) {
      return;
    }
    this.isReading = true;
    if (!this.didWritePairs) {
      while (true) {
        const [key, pair] = await this.getInsertionPair();
        if (key && pair) {
          let buffer;
          if (this.skipInsertionComma) {
            this.skipInsertionComma = false;
            buffer = Buffer.concat([OPEN_BUFFER, key.slice(this.namespaceLength), MID_BUFFER, pair, CLOSE_BUFFER]);
          } else {
            buffer = Buffer.concat([COMMA_BUFFER, OPEN_BUFFER, key.slice(this.namespaceLength), MID_BUFFER, pair, CLOSE_BUFFER]);
          }
          const shouldKeepPushing = this.push(buffer);
          if (!shouldKeepPushing) {
            this.isReading = false;
            return;
          }
        } else {
          break;
        }
      }
      this.push(Buffer.from('],['));
      this.didWritePairs = true;
      await new Promise((resolve, reject) => {
        this.insertionIterator.end((error:Error | void) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
    if (!this.didWriteDeletions) {
      while (true) {
        const [id, key] = await this.getDeletionPair();
        if (id && key) {
          const slicedId = id.slice(this.namespaceLength);
          let buffer;
          if (this.skipDeletionComma) {
            this.skipDeletionComma = false;
            buffer = Buffer.concat([OPEN_BUFFER, slicedId, MID_BUFFER, key, CLOSE_BUFFER]);
          } else {
            buffer = Buffer.concat([COMMA_BUFFER, OPEN_BUFFER, slicedId, MID_BUFFER, key, CLOSE_BUFFER]);
          }
          const shouldKeepPushing = this.push(buffer);
          if (!shouldKeepPushing) {
            this.isReading = false;
            return;
          }
        } else {
          break;
        }
      }
      this.didWriteDeletions = true;
      await new Promise((resolve, reject) => {
        this.deletionIterator.end((error:Error | void) => {
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
    this.isReading = false;
  }

  _read() {
    this.readFromLevelDbIterators();
  }
}

module.exports = ReadableJsonDump;
