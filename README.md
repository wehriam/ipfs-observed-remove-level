# IPFS Observed-Remove Set and Map

[![CircleCI](https://circleci.com/gh/wehriam/ipfs-observed-remove-level.svg?style=svg)](https://circleci.com/gh/wehriam/ipfs-observed-remove-level) [![npm version](https://badge.fury.io/js/ipfs-observed-remove-level.svg)](http://badge.fury.io/js/ipfs-observed-remove-level) [![codecov](https://codecov.io/gh/wehriam/ipfs-observed-remove-level/branch/master/graph/badge.svg)](https://codecov.io/gh/wehriam/ipfs-observed-remove-level)

Eventually-consistent, conflict-free replicated data types (CRDT) [implemented](https://github.com/wehriam/ipfs-observed-remove-level/blob/master/src/index.js) using IPFS and [LevelDB](https://www.npmjs.com/package/level).

This module and the IPFS PubSub system are experimental. If you encounter an issue, fork the repository, [write tests demonstrating](https://github.com/wehriam/ipfs-observed-remove-level/tree/master/tests) the issue, and create a [pull request](https://github.com/wehriam/ipfs-observed-remove-level).

```js
const os = require('os');
const path = require('path');
const uuid = require('uuid');
const level = require('level');
const ipfsAPI = require('ipfs-http-client');
const { IpfsObservedRemoveMap } = require('ipfs-observed-remove-level');

const run = async () => {

  const location = path.join(os.tmpdir(), uuid.v4());
  const db = level(location, { valueEncoding: 'json' });
  // IPFS nodes with PubSub enabled
  const ipfs1 = ipfsAPI('/ip4/127.0.0.1/tcp/5001'); 
  const ipfs2 = ipfsAPI('/ip4/127.0.0.1/tcp/5002');

  const topic = "CRDT_MAP";

  const alice = new IpfsObservedRemoveMap(db, ipfs1, topic, [], { namespace:'alice' });
  const bob = new IpfsObservedRemoveMap(db, ipfs2, topic, [], { namespace:'bob' });

  alice.on('set', (key, value) => {
    console.log(key, value); // logs [a, 1], [b, 2]
  });

  await alice.set('a', 1);
  await bob.set('b', 2);

  // Later

  await alice.get('b'); // 2
  await bob.get('a'); // 1
}
```

## Install

`yarn add ipfs-observed-remove-level`

## Set API

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

### Table of Contents

## Map API

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

#### Table of Contents

-   [constructor](#constructor)
    -   [Parameters](#parameters)
-   [ipfsSync](#ipfssync)
-   [getIpfsHash](#getipfshash)
-   [getIpfsHashes](#getipfshashes)
-   [ipfsPeerCount](#ipfspeercount)
-   [shutdown](#shutdown)
-   [IpfsObservedRemoveSet#readyPromise](#ipfsobservedremovesetreadypromise)

### constructor

Create an observed-remove CRDT.

#### Parameters

-   `db`  
-   `ipfs` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)?** Object implementing the [core IPFS API](https://github.com/ipfs/interface-ipfs-core#api), most likely a [js-ipfs](https://github.com/ipfs/js-ipfs) or [ipfs-http-client](https://github.com/ipfs/js-ipfs-http-client) object.
-   `topic` **[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)?** IPFS pubub topic to use in synchronizing the CRDT.
-   `entries` **Iterable&lt;V>** Iterable of initial values (optional, default `[]`)
-   `options` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)**  (optional, default `{}`)
    -   `options.maxAge` **[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Max age of insertion/deletion identifiers (optional, default `5000`)
    -   `options.bufferPublishing` **[String](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** Interval by which to buffer 'publish' events (optional, default `20`)

### ipfsSync

Publish an IPFS hash of an array containing all of the object's insertions and deletions.

Returns **[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)&lt;[Array](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Array)&lt;any>>** 

### getIpfsHash

Stores and returns an IPFS hash of the current insertions and deletions

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)&lt;[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)>** 

### getIpfsHashes

Stores and returns an IPFS hash of the current insertions and deletions

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)&lt;[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)>** 

### ipfsPeerCount

Current number of IPFS pubsub peers.

Returns **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 

### shutdown

Gracefully shutdown

Returns **void** 

### IpfsObservedRemoveSet#readyPromise

Resolves when IPFS topic subscriptions are confirmed.

Type: [Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)&lt;void>
