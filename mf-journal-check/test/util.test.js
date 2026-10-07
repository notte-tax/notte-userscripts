const test = require('node:test');
const assert = require('node:assert/strict');
const { norm, parseAmount, dayNumber } = require('../src/util');

test('norm: 全角英数・空白をそろえる', () => {
  assert.equal(norm('  課仕　１０％ '), '課仕 10%');
  assert.equal(norm('（軽）'), '(軽)');
  assert.equal(norm(null), '');
  assert.equal(norm(undefined), '');
});

test('parseAmount: カンマ付きの金額', () => {
  assert.equal(parseAmount('120,000'), 120000);
  assert.equal(parseAmount(' 1,234 '), 1234);
  assert.equal(parseAmount('-5,000'), -5000);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount(null), 0);
});

test('dayNumber: 日数の差が取れる', () => {
  assert.equal(dayNumber('2026-03-01') - dayNumber('2026-02-28'), 1);
  assert.equal(dayNumber('2025-10-18') - dayNumber('2025-10-15'), 3);
});

test('parseAmount: 余計な文字があっても最初の数値を取る', () => {
  assert.equal(parseAmount('11,000 (1,000)'), 11000);
  assert.equal(parseAmount('¥3,300'), 3300);
});
