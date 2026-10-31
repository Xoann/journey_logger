import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAmount } from '../src/amount.js';

test('amounts support ordinary numbers and basic arithmetic with standard precedence', () => {
  for (const [input, expected] of [
    [45, 45], ['45', 45], ['57.5', 57.5], ['.5', .5],
    ['3*21+45', 108], ['45+3*21', 108], [' 3 * 21 + 45 ', 108],
    ['(21+4)*3', 75], ['120/2/3', 20], ['60-20-10', 30],
    ['2*(3+(10/2))', 16], ['2.5*21+.5', 53], ['30+-5', 25],
    ['30-(-5)', 35], ['+45', 45], ['-(3-10)', 7],
  ]) assert.equal(parseAmount(input), expected, String(input));
});

test('amounts reject incomplete expressions, unsupported syntax, and executable input', () => {
  for (const input of [
    '', ' ', '3*', '*3', '3**2', '3//2', '3^^2', '2^3', '3%2',
    '()', '(3+2', '3+2)', '2(3)', '1 2', '1..2', '1,000',
    '21min', '1e2', '0x10', 'Math.max(3,4)', 'process.exit()', '1;2',
  ]) assert.throws(() => parseAmount(input), /Use numbers/, input);
});

test('amounts require positive finite totals and reject division by zero and overflow', () => {
  for (const input of [0, -1, NaN, Infinity, '0', '-1', '3-3', '3-5']) {
    assert.throws(() => parseAmount(input), /positive finite/, String(input));
  }
  for (const input of ['3/0', '0/0', '3/(2-2)', '1/(1/0)']) {
    assert.throws(() => parseAmount(input), /divide by zero/, input);
  }
  const huge = '1' + '0'.repeat(308);
  assert.throws(() => parseAmount(`${huge}*10/10`), /finite/);
  assert.throws(() => parseAmount('9'.repeat(309)), /finite/);
});

test('amounts bound input size and nesting', () => {
  assert.throws(() => parseAmount('1'.repeat(4097)), /4096/);
  assert.equal(parseAmount('('.repeat(32) + '1' + ')'.repeat(32)), 1);
  assert.throws(() => parseAmount('('.repeat(33) + '1' + ')'.repeat(33)), /nested/);
});
