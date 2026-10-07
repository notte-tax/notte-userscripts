const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { BOOKS_URL, makeBooksHtml, SAMPLE } = require('./fixtures/books-fixture');
const { SELECTORS, ReaderError, readPeriod, resolveDate, readJournals } = require('../src/reader');

function load(html, url = BOOKS_URL) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url });
  return dom.window;
}

test('readPeriod: URL の期間を読む', () => {
  const win = load('');
  assert.deepEqual(readPeriod(win.location.search, win.document), { from: '2025-09-01', to: '2026-08-31' });
});

test('readPeriod: URL に無ければ画面の日付入力欄を読む', () => {
  const win = load('<input value="2025/09/01"><input value="2026/08/31">', 'https://accounting.moneyforward.com/books');
  assert.deepEqual(readPeriod(win.location.search, win.document), { from: '2025-09-01', to: '2026-08-31' });
});

test('readPeriod: どこにも無ければ null', () => {
  const win = load('', 'https://accounting.moneyforward.com/books');
  assert.equal(readPeriod(win.location.search, win.document), null);
});

test('resolveDate: 期間から年を補う', () => {
  const p = { from: '2025-09-01', to: '2026-08-31' };
  assert.equal(resolveDate('10/15', p), '2025-10-15');
  assert.equal(resolveDate('03/31', p), '2026-03-31');
  assert.equal(resolveDate('09/01開始仕訳', p), '2025-09-01');
});

test('resolveDate: 年が1つに決まらない・期間が無いときは null', () => {
  assert.equal(resolveDate('10/15', { from: '2025-01-01', to: '2026-12-31' }), null);
  assert.equal(resolveDate('10/15', null), null);
  assert.equal(resolveDate('', { from: '2025-09-01', to: '2026-08-31' }), null);
});

test('readJournals: 3件の仕訳を読む（開始仕訳・単一・複合）', () => {
  const win = load(makeBooksHtml(SAMPLE));
  const tbody = win.document.querySelector(SELECTORS.tbody);
  const js = readJournals(tbody, readPeriod(win.location.search, win.document));
  assert.equal(js.length, 3);

  assert.equal(js[0].no, '1');
  assert.equal(js[0].date, '2025-09-01');
  assert.equal(js[0].isOpening, true);
  assert.equal(js[0].branches[0].debit.item, '普通預金');
  assert.equal(js[0].branches[0].debit.category, 'asset');
  assert.equal(js[0].branches[0].credit.category, 'capital');

  assert.equal(js[1].date, '2025-10-15');
  assert.equal(js[1].isOpening, false);
  assert.equal(js[1].branches[0].debit.category, 'expense');
  assert.equal(js[1].branches[0].debit.tax.kind, '課仕');
  assert.equal(js[1].branches[0].debit.amount, 120000);
  assert.equal(js[1].branches[0].debit.partner, 'テスト商店');
  assert.equal(js[1].branches[0].remark, 'プリンター購入');

  assert.equal(js[2].date, '2026-03-31');
  assert.equal(js[2].branches.length, 2);
  assert.equal(js[2].rows.length, 2);
  assert.equal(js[2].branches[1].debit, null);
  assert.equal(js[2].branches[1].credit.item, '預り金');
  assert.equal(js[2].branches[1].credit.subItem, '所得税');
  assert.equal(js[2].branches[1].remark, '3月分給与');
});

test('readJournals: 列の目印が無ければ ReaderError', () => {
  const html = '<table><tbody data-testid="ca-client-test-child-tbody"><tr data-testid="ca-client-test-child-journal-first-row"><td>1</td></tr></tbody></table>';
  const win = load(html);
  const tbody = win.document.querySelector(SELECTORS.tbody);
  assert.throws(() => readJournals(tbody, null), ReaderError);
});

test('readJournals: 仕訳が0件の表は空配列', () => {
  const win = load('<table><tbody data-testid="ca-client-test-child-tbody"><tr><td>該当する仕訳はありません</td></tr></tbody></table>');
  assert.deepEqual(readJournals(win.document.querySelector(SELECTORS.tbody), null), []);
});
