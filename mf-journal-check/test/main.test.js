const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { BOOKS_URL, makeBooksHtml, makeRowsHtml, SAMPLE } = require('./fixtures/books-fixture');
const { SELECTORS } = require('../src/reader');
const { start } = require('../src/main');

const UNKNOWN_TAX = {
  no: '10', dateText: '11/01',
  branches: [{ debit: { item: '雑費', category: 'expense', tax: '不明', amount: '1,000' },
    credit: { item: '現金', category: 'asset', tax: '対象外', amount: '1,000' }, remark: 'テスト' }],
};

function open(url, before) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${makeBooksHtml(SAMPLE)}</body></html>`, { url });
  if (before) before(dom.window);
  start(dom.window);
  return dom.window;
}
const badges = (doc) => [...doc.querySelectorAll('.njc-badge')].map((b) => b.textContent);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('開いた直後にチェックし、表が入れ替わったらやり直す', async () => {
  const win = open(BOOKS_URL);
  const doc = win.document;
  assert.deepEqual(badges(doc), ['R036', 'R028']);
  assert.match(doc.getElementById('njc-panel').textContent, /修正必須 1/);

  doc.querySelector(SELECTORS.tbody).innerHTML = makeRowsHtml([UNKNOWN_TAX]);
  await wait(500);
  assert.deepEqual(badges(doc), ['R001']);
  assert.match(doc.getElementById('njc-panel').textContent, /このページ 1件中/);
  win.close();
});

test('自分の書き換えでは再チェックしない（無限ループしない）', async () => {
  const win = open(BOOKS_URL);
  const before = win.document.querySelector('.njc-badge');
  await wait(500);
  assert.equal(win.document.querySelector('.njc-badge'), before);
  win.close();
});

test('仕訳帳以外の画面では何もしない', () => {
  const win = open('https://accounting.moneyforward.com/books/general_ledger');
  assert.equal(win.document.getElementById('njc-panel'), null);
  assert.deepEqual(badges(win.document), []);
  win.close();
});

test('オフに設定してあれば色を付けない', () => {
  const win = open(BOOKS_URL, (w) => w.localStorage.setItem('notte-jc-settings', JSON.stringify({ enabled: false })));
  assert.deepEqual(badges(win.document), []);
  assert.match(win.document.getElementById('njc-panel').textContent, /チェックはオフです/);
  win.close();
});

test('パネルでオフにすると色が消え、設定が保存される', () => {
  const win = open(BOOKS_URL);
  win.document.querySelector('#njc-panel input[name="enabled"]').click();
  assert.deepEqual(badges(win.document), []);
  assert.equal(JSON.parse(win.localStorage.getItem('notte-jc-settings')).enabled, false);
  win.close();
});

test('画面のつくりが変わっていたらエラー表示だけ出す', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><table><tbody data-testid="ca-client-test-child-tbody"><tr data-testid="ca-client-test-child-journal-first-row"><td>1</td></tr></tbody></table></body></html>', { url: BOOKS_URL });
  start(dom.window);
  assert.match(dom.window.document.getElementById('njc-panel').textContent, /チェックできません/);
  dom.window.close();
});

test('読み取れる仕訳が0件なら「0件で問題なし」に見せない', async () => {
  const win = open(BOOKS_URL);
  const doc = win.document;
  doc.querySelector(SELECTORS.tbody).innerHTML = '<tr><td>該当する仕訳はありません</td></tr>';
  await wait(500);
  assert.deepEqual(badges(doc), []);
  const text = doc.getElementById('njc-panel').textContent;
  assert.match(text, /読み取れる仕訳がありません/);
  assert.doesNotMatch(text, /修正必須 0/);
  win.close();
});

test('表そのものが消えたらパネルも消える', async () => {
  const win = open(BOOKS_URL);
  const doc = win.document;
  assert.ok(doc.getElementById('njc-panel'));
  doc.querySelector('table').remove();
  await wait(500);
  assert.equal(doc.getElementById('njc-panel'), null);
  win.close();
});
