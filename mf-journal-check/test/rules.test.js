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

test('R054: 摘要の言葉と科目が合わない', () => {
  const fs = run([J('1', '2025-10-01', [B(S('通信費', 'expense', '課仕 10%'), BANK, '電気代 9月分')])]);
  assert.deepEqual(ids(fs), ['R054:懸念']);
  assert.match(fs[0].message, /「電気」/);
  assert.match(fs[0].message, /通信費/);
});

test('R054: 想定どおりの科目・どれかの想定に入る科目なら出さない', () => {
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('水道光熱費', 'expense', '課仕 10%'), BANK, '電気代 9月分')])])), []);
  // 「高速」は旅費交通費の言葉だが「インターネット」は通信費の言葉。通信費ならどちらかの想定に入るので出さない
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('通信費', 'expense', '課仕 10%'), BANK, '高速インターネット')])])), []);
  // 英字は大文字小文字・全角半角を問わない
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('消耗品費', 'expense', '課仕 10%'), BANK, 'ｅｔｃ利用')])])), ['R054:懸念']);
});

test('R054: 費用以外の科目は見ない', () => {
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('前払費用', 'asset', '対象外'), BANK, '電気代 前払')])])), []);
});

test('摘要空欄: 費用を含む仕訳で全行の摘要が空', () => {
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('雑費', 'expense', '課仕 10%'), BANK, '')])])), ['EX-摘要空欄:懸念']);
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('雑費', 'expense', '課仕 10%'), BANK, '')])], { checkEmptyRemark: false })), []);
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(BANK, S('売掛金', 'asset', '対象外'), '')])])), []);
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B(S('雑費', 'expense', '課仕 10%'), BANK, ''), B(null, BANK, '振込')])])), []);
});

const RENT = (amount = 50000) => [B(S('地代家賃', 'expense', '課仕 10%', amount), S('普通預金', 'asset', '対象外', amount), '事務所家賃')];

test('R051: 同じ日・同じ科目・同じ金額は重複候補（両方に付く）', () => {
  const fs = run([J('10', '2025-10-01', RENT()), J('11', '2025-10-01', RENT())]);
  assert.deepEqual(ids(fs), ['R051:要確認', 'R051:要確認']);
  assert.match(fs.find((f) => f.journalNo === '10').message, /No\.11/);
  assert.match(fs[0].message, /重複候補/);
});

test('R052: 3日以内のずれは懸念、4日は出さない', () => {
  assert.deepEqual(ids(run([J('10', '2025-10-01', RENT()), J('11', '2025-10-04', RENT())])), ['R052:懸念', 'R052:懸念']);
  assert.deepEqual(ids(run([J('10', '2025-10-01', RENT()), J('11', '2025-10-05', RENT())])), []);
});

test('R051: 金額が違えば出さない・開始仕訳と日付不明は比べない', () => {
  assert.deepEqual(ids(run([J('10', '2025-10-01', RENT(50000)), J('11', '2025-10-01', RENT(60000))])), []);
  assert.deepEqual(ids(run([J('10', '2025-10-01', RENT(), true), J('11', '2025-10-01', RENT())])), []);
  assert.deepEqual(ids(run([J('10', null, RENT()), J('11', null, RENT())])), []);
});

test('R055: 同じ摘要で費用の科目が分かれている', () => {
  const a = J('20', '2025-10-01', [B(S('消耗品費', 'expense', '課仕 10%', 3000), BANK, 'アマゾン')]);
  const b = J('21', '2025-10-09', [B(S('通信費', 'expense', '課仕 10%', 2000), BANK, 'アマゾン')]);
  const fs = run([a, b]);
  assert.deepEqual(ids(fs), ['R055:懸念', 'R055:懸念']);
  assert.match(fs[0].message, /消耗品費/);
  assert.match(fs[0].message, /通信費/);
});

test('R055: 科目が同じ・摘要が1文字なら出さない', () => {
  const same = [J('20', '2025-10-01', [B(S('消耗品費', 'expense', '課仕 10%', 3000), BANK, 'アマゾン')]), J('21', '2025-10-09', [B(S('消耗品費', 'expense', '課仕 10%', 2000), BANK, 'アマゾン')])];
  assert.deepEqual(ids(run(same)), []);
  const short = [J('20', '2025-10-01', [B(S('消耗品費', 'expense', '課仕 10%', 3000), BANK, 'A')]), J('21', '2025-10-09', [B(S('通信費', 'expense', '課仕 10%', 2000), BANK, 'A')])];
  assert.deepEqual(ids(run(short)), []);
});

test('R028: 通勤手当は課税仕入なので対象外', () => {
  assert.deepEqual(ids(run([J('1', '2025-10-01', [B({ ...S('給料手当', 'expense', '課仕 10%'), subItem: '通勤手当' }, BANK)])])), []);
  const withRemark = B(S('給料手当', 'expense', '課仕 10%'), BANK);
  withRemark.remark = '9月分通勤手当';
  assert.deepEqual(ids(run([J('1', '2025-10-01', [withRemark])])), []);
});

test('R051: 1000円未満は比べない（振込手数料など）、1000円ちょうどは比べる', () => {
  assert.deepEqual(ids(run([J('10', '2025-10-01', RENT(999)), J('11', '2025-10-01', RENT(999))])), []);
  assert.deepEqual(ids(run([J('10', '2025-10-01', RENT(1000)), J('11', '2025-10-01', RENT(1000))])), ['R051:要確認', 'R051:要確認']);
});

test('R055: 決まり文句の摘要は比べない（完全一致のみ）', () => {
  const mk = (remark) => [
    J('20', '2025-10-01', [B(S('消耗品費', 'expense', '課仕 10%', 3000), BANK, remark)]),
    J('21', '2025-10-09', [B(S('通信費', 'expense', '課仕 10%', 2000), BANK, remark)]),
  ];
  assert.deepEqual(ids(run(mk('当月分'))), []);
  assert.deepEqual(ids(run(mk('当月分 会費'))), ['R055:懸念', 'R055:懸念']);
});
