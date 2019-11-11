// @flow

const expect = require('expect');
const {
  MatcherHintOptions,
  matcherHint,
  printDiffOrStringify,
  printExpected,
  printReceived,
  stringify,
} = require('jest-matcher-utils');
const { equals } = require('expect/build/jasmineUtils');
const {
  iterableEquality,
} = require('expect/build//utils');
// The optional property of matcher context is true if undefined.
const isExpand = (expand?: boolean): boolean => expand !== false;

const EXPECTED_LABEL = 'Expected';
const RECEIVED_LABEL = 'Received';

// const diff = require('jest-diff');

expect.extend({
  async asyncIteratesTo(asyncIterable, expected) {
    const received = [];

    for await (const value of asyncIterable) {
      received.push(value);
    }

    const matcherName = 'asyncIteratesTo';
    const options: MatcherHintOptions = {
      comment: 'deep equality',
      isNot: this.isNot,
      promise: this.promise,
    };

    const pass = equals(received, expected, [iterableEquality]);

    const message = pass
      ? () =>
        `${matcherHint(matcherName, undefined, undefined, options)
        }\n\n` +
          `Expected: not ${printExpected(expected)}\n${
            stringify(expected) !== stringify(received)
              ? `Received:     ${printReceived(received)}`
              : ''}`
      : () =>
        `${matcherHint(matcherName, undefined, undefined, options)
        }\n\n${
          printDiffOrStringify(
            expected,
            received,
            EXPECTED_LABEL,
            RECEIVED_LABEL,
            isExpand(this.expand),
          )}`;

    return { actual: received, expected, message, name: matcherName, pass };
  },
});
