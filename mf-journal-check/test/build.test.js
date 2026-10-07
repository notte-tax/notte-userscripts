const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSource } = require('../../build');

const src = buildSource();
const END = '// ==/UserScript==';
const header = src.slice(0, src.indexOf(END));
const body = src.slice(src.indexOf(END) + END.length);

test('連結結果が構文として正しい（名前の重複も無い）', () => {
  assert.doesNotThrow(() => new vm.Script(src));
});

test('node 用の行が残っていない', () => {
  assert.doesNotMatch(src, /node-only/);
  assert.doesNotMatch(body, /\brequire\(/);
  assert.doesNotMatch(body, /module\.exports/);
});

test('ヘッダー: 仕訳帳だけ・通信の権限なし・自動更新の URL', () => {
  assert.match(header, /^\/\/ ==UserScript==/);
  assert.match(header, /@match\s+https:\/\/accounting\.moneyforward\.com\/books\*\n/);
  assert.equal((header.match(/@match/g) || []).length, 1);
  assert.match(header, /@grant\s+none/);
  assert.doesNotMatch(header, /@connect/);
  assert.match(header, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/notte-tax\/notte-userscripts\/main\/dist\/mf-journal-check\.user\.js/);
  assert.match(header, /@version\s+\d+\.\d+\.\d+/);
});

test('本体に外部へ通信するコードが無い', () => {
  for (const banned of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /\beval\s*\(/, /new Function/, /\bimport\s*\(/, /https?:\/\//, /GM_/]) {
    assert.doesNotMatch(body, banned, `found ${banned}`);
  }
});

test('dist が最新の build 結果と一致する（build し忘れ防止）', () => {
  const dist = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'mf-journal-check.user.js'), 'utf8');
  assert.equal(dist, src);
});
