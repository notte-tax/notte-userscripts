const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTax } = require('../src/tax');
const { CONFIG } = require('../src/config');
const { runRules, SEVERITY } = require('../src/rules');

// 架空データを短く書くための道具
const S = (item, category, tax, amount = 1000) => ({ item, subItem: '', partner: '', category, tax: parseTax(tax), amount });
const B = (debit, credit, remark = 'テスト') => ({ debit, credit, remark });
const J = (no, date, branches, isOpening = false) => ({ no, date, isOpening, branches, rows: [] });
const BANK = S('普通預金', 'asset', '対象外');
const ids = (fs) => fs.map((f) => `${f.ruleId}:${f.severity}`).sort();
const run = (js, opts) => runRules(js, CONFIG, opts);

test('R001: 税区分が不明', () => {
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('雑費', 'expense', '不明'), BANK)])])), ['R001:修正必須']);
});

test('R022: 売上高に対象外は修正必須、非売は要確認', () => {
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(BANK, S('売上高', 'revenue', '対象外'))])])), ['R022:修正必須']);
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(BANK, S('売上高', 'revenue', '非売'))])])), ['R022:要確認']);
});

test('R022: 課売の売上高・非売の受取利息は対象外', () => {
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(BANK, S('売上高', 'revenue', '課売 10%'))])])), []);
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(BANK, S('受取利息', 'revenue', '非売'))])])), []);
});

test('R028: 給与系に課仕（個別対応の共-も含む）', () => {
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('給料手当', 'expense', '課仕 10%'), BANK)])])), ['R028:修正必須']);
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('法定福利費', 'expense', '共-課仕 10%'), BANK)])])), ['R028:修正必須']);
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('給料手当', 'expense', '対象外'), BANK)])])), []);
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('旅費交通費', 'expense', '課仕 10%'), BANK)])])), []);
});

test('R044: 受取利息に課売', () => {
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(BANK, S('受取利息', 'revenue', '課売 10%'))])])), ['R044:修正必須']);
});

test('R068: 2026/10/1以降に80%控除', () => {
  const side = S('外注費', 'expense', '課仕 10%80%控除');
  assert.deepEqual(ids(run([J('1', '2026-10-01', [B(side, BANK)])])), ['R068:要確認']);
  assert.deepEqual(ids(run([J('1', '2026-09-30', [B(side, BANK)])])), []);
  assert.deepEqual(ids(run([J('1', null, [B(side, BANK)])])), []);
});

test('R036: 消耗品費 10万円以上', () => {
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('消耗品費', 'expense', '課仕 10%', 100000), BANK)])])), ['R036:要確認']);
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('消耗品費', 'expense', '課仕 10%', 99999), BANK)])])), []);
});

test('R035: 修繕費 20万円以上', () => {
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('修繕費', 'expense', '課仕 10%', 200000), BANK)])])), ['R035:懸念']);
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('修繕費', 'expense', '課仕 10%', 199999), BANK)])])), []);
});

test('開始仕訳はどのルールでも見ない', () => {
  assert.deepEqual(run([J('1', '2025-09-01', [B(S('雑費', 'expense', '不明'), BANK)], true)]), []);
});

test('Finding に仕訳の番号と位置が入る', () => {
  const fs = run([J('1', '2025-10-01', [B(BANK, BANK)]), J('7', '2025-10-02', [B(S('雑費', 'expense', '不明'), BANK)])]);
  assert.equal(fs.length, 1);
  assert.equal(fs[0].journalIndex, 1);
  assert.equal(fs[0].journalNo, '7');
  assert.equal(fs[0].severity, SEVERITY.MUST);
  assert.match(fs[0].message, /不明/);
});
