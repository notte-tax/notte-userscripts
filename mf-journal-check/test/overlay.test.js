const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { BOOKS_URL, makeBooksHtml, SAMPLE } = require('./fixtures/books-fixture');
const { SELECTORS, readPeriod, readJournals } = require('../src/reader');
const { CONFIG } = require('../src/config');
const { runRules } = require('../src/rules');
const {
  COLORS, DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings,
  applyMarks, clearMarks, countBySeverity, renderPanel,
} = require('../src/overlay');

function setup() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${makeBooksHtml(SAMPLE)}</body></html>`, { url: BOOKS_URL });
  const doc = dom.window.document;
  const journals = readJournals(doc.querySelector(SELECTORS.tbody), readPeriod(dom.window.location.search, doc));
  return { doc, journals, findings: runRules(journals, CONFIG) };
}
const noop = () => {};
const handlers = { onToggleEnabled: noop, onToggleEmptyRemark: noop, onToggleCollapsed: noop };

test('applyMarks: 該当仕訳に色帯と札を付ける', () => {
  const { doc, journals, findings } = setup();
  applyMarks(journals, findings);
  const first = (k) => journals[k].rows[0];
  assert.equal(first(0).querySelector('.njc-badge'), null);
  assert.equal(first(1).querySelector('.njc-badge').textContent, 'R036');
  assert.match(first(1).querySelector('.njc-badge').title, /【要確認】/);
  assert.ok(first(1).cells[0].classList.contains('njc-band-check'));
  assert.equal(first(2).querySelector('.njc-badge').textContent, 'R028');
  assert.ok(first(2).cells[0].classList.contains('njc-band-must'));
  assert.ok(first(2).querySelector(SELECTORS.options).querySelector('.njc-badges'));
  assert.equal(first(2).getAttribute('data-njc-severities'), '修正必須');
  assert.equal(doc.querySelectorAll('.njc-badges').length, 2);
});

test('clearMarks: 付けたものをすべて外す', () => {
  const { doc, journals, findings } = setup();
  applyMarks(journals, findings);
  clearMarks(doc);
  assert.equal(doc.querySelectorAll('.njc-badges').length, 0);
  assert.equal(doc.querySelectorAll('[class*="njc-band-"]').length, 0);
  assert.equal(doc.querySelectorAll('[data-njc-severities]').length, 0);
});

test('countBySeverity: 重要度ごとの仕訳の件数', () => {
  const { findings } = setup();
  assert.deepEqual(countBySeverity(findings), { '修正必須': 1, '要確認': 1, '懸念': 0 });
});

test('renderPanel: 件数と表示中の件数。何度呼んでもパネルは1つ', () => {
  const { doc, findings } = setup();
  const view = { state: 'ok', settings: { ...DEFAULT_SETTINGS }, counts: countBySeverity(findings), total: 3 };
  renderPanel(doc, view, handlers);
  renderPanel(doc, view, handlers);
  const panels = doc.querySelectorAll('#njc-panel');
  assert.equal(panels.length, 1);
  assert.match(panels[0].textContent, /修正必須 1/);
  assert.match(panels[0].textContent, /懸念 0/);
  assert.match(panels[0].textContent, /このページ 3件中/);
  assert.ok(panels[0].querySelector('button[data-severity="懸念"]').disabled);
});

test('renderPanel: 画面が読めないとき・オフのとき', () => {
  const { doc } = setup();
  renderPanel(doc, { state: 'error', settings: { ...DEFAULT_SETTINGS } }, handlers);
  assert.match(doc.getElementById('njc-panel').textContent, /MFの画面が変わったため、チェックできません/);
  renderPanel(doc, { state: 'off', settings: { ...DEFAULT_SETTINGS, enabled: false } }, handlers);
  assert.match(doc.getElementById('njc-panel').textContent, /チェックはオフです/);
});

test('renderPanel: 切り替えのチェックボックスが handlers を呼ぶ', () => {
  const { doc } = setup();
  let called = '';
  renderPanel(doc, { state: 'ok', settings: { ...DEFAULT_SETTINGS }, counts: { '修正必須': 0, '要確認': 0, '懸念': 0 }, total: 0 }, {
    onToggleEnabled: () => { called += 'E'; },
    onToggleEmptyRemark: () => { called += 'R'; },
    onToggleCollapsed: () => { called += 'C'; },
  });
  doc.querySelector('#njc-panel input[name="enabled"]').click();
  doc.querySelector('#njc-panel input[name="checkEmptyRemark"]').click();
  doc.querySelector('#njc-panel .njc-fold').click();
  assert.equal(called, 'ERC');
});

test('設定: 読めない・壊れている・保存できないときは初期値で動く', () => {
  assert.deepEqual(loadSettings(null), DEFAULT_SETTINGS);
  const broken = { getItem: () => '{oops', setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(loadSettings(broken), DEFAULT_SETTINGS);
  assert.doesNotThrow(() => saveSettings(broken, DEFAULT_SETTINGS));
  const store = new Map();
  const mem = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveSettings(mem, { ...DEFAULT_SETTINGS, enabled: false });
  assert.equal(JSON.parse(store.get(SETTINGS_KEY)).enabled, false);
  assert.equal(loadSettings(mem).enabled, false);
});

test('色: 白地でコントラスト比 4.5:1 以上', () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const [sev, hex] of Object.entries(COLORS)) {
    const ratio = 1.05 / (lum(hex) + 0.05);
    assert.ok(ratio >= 4.5, `${sev} ${hex} is ${ratio.toFixed(2)}:1`);
  }
});
