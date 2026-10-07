// mf-journal-check/src を1本の Tampermonkey スクリプトに連結する。
// 各ファイルの「// node-only」が付いた行（require / module.exports）は取り除く。
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_DIR = path.join(__dirname, 'mf-journal-check');
const ORDER = ['util.js', 'tax.js', 'config.js', 'reader.js', 'rules.js', 'overlay.js', 'main.js'];
const OUT = path.join(__dirname, 'dist', 'mf-journal-check.user.js');

function buildSource() {
  const header = fs.readFileSync(path.join(SCRIPT_DIR, 'header.txt'), 'utf8').replace(/\r\n/g, '\n').trim();
  const body = ORDER.map((file) => {
    const src = fs.readFileSync(path.join(SCRIPT_DIR, 'src', file), 'utf8').replace(/\r\n/g, '\n');
    const kept = src.split('\n').filter((line) => !line.includes('// node-only')).join('\n').trim();
    return `// ---- ${file} ----\n${kept}\n`;
  }).join('\n');
  return `${header}\n\n(function () {\n'use strict';\n\n${body}\nstart(window);\n})();\n`;
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buildSource());
  console.log(`built ${path.relative(__dirname, OUT)}`);
}

module.exports = { buildSource };
