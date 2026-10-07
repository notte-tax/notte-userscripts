const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTax } = require('../src/tax');

const pick = (t) => ({ kind: t.kind, allocation: t.allocation, rate: t.rate, reduced: t.reduced, deductionPct: t.deductionPct });

test('実画面で見た表記をすべて解析できる', () => {
  assert.deepEqual(pick(parseTax('課売 10%')), { kind: '課売', allocation: null, rate: 10, reduced: false, deductionPct: null });
  assert.deepEqual(pick(parseTax('非売')), { kind: '非売', allocation: null, rate: null, reduced: false, deductionPct: null });
  assert.deepEqual(pick(parseTax('対象外')), { kind: '対象外', allocation: null, rate: null, reduced: false, deductionPct: null });
  assert.deepEqual(pick(parseTax('対象外仕')), { kind: '対象外仕', allocation: null, rate: null, reduced: false, deductionPct: null });
  assert.deepEqual(pick(parseTax('課仕 10%')), { kind: '課仕', allocation: null, rate: 10, reduced: false, deductionPct: null });
  assert.deepEqual(pick(parseTax('課仕 (軽)8%')), { kind: '課仕', allocation: null, rate: 8, reduced: true, deductionPct: null });
  assert.deepEqual(pick(parseTax('課仕 10%80%控除')), { kind: '課仕', allocation: null, rate: 10, reduced: false, deductionPct: 80 });
  assert.deepEqual(pick(parseTax('共-課仕 10%')), { kind: '課仕', allocation: '共', rate: 10, reduced: false, deductionPct: null });
  assert.deepEqual(pick(parseTax('共-課仕 (軽)8%')), { kind: '課仕', allocation: '共', rate: 8, reduced: true, deductionPct: null });
  assert.deepEqual(pick(parseTax('共-課仕 10%80%控除')), { kind: '課仕', allocation: '共', rate: 10, reduced: false, deductionPct: 80 });
  assert.deepEqual(pick(parseTax('非-課仕 10%')), { kind: '課仕', allocation: '非', rate: 10, reduced: false, deductionPct: null });
});

test('全角の表記でも同じ結果になる', () => {
  assert.deepEqual(pick(parseTax('課仕　（軽）８％')), pick(parseTax('課仕 (軽)8%')));
});

test('不明・空欄・未知の表記', () => {
  assert.equal(parseTax('不明').kind, '不明');
  assert.equal(parseTax('').kind, '空');
  assert.equal(parseTax(null).kind, '空');
  assert.equal(parseTax('免売').kind, '免売');
  assert.equal(parseTax('なにか新しい区分').kind, 'その他');
});

test('raw には正規化した元の文字列が入る', () => {
  assert.equal(parseTax(' 共-課仕 10% ').raw, '共-課仕 10%');
});
