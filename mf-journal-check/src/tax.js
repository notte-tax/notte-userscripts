// MFの税区分の表記（例: "共-課仕 10%80%控除"）を構造化する
const { norm } = require('./util'); // node-only

const TAX_KINDS = ['対象外仕', '対象外', '課売', '非売', '免売', '課仕', '非仕', '不明'];

function parseTax(raw) {
  const text = norm(raw);
  const tax = { raw: text, kind: '空', allocation: null, rate: null, reduced: false, deductionPct: null };
  if (!text) return tax;

  let rest = text;
  const alloc = rest.match(/^(共|非|課)-/);
  if (alloc) {
    tax.allocation = alloc[1];
    rest = rest.slice(alloc[0].length);
  }
  const ded = rest.match(/(\d+)%控除/);
  if (ded) {
    tax.deductionPct = Number(ded[1]);
    rest = rest.replace(ded[0], '');
  }
  if (rest.includes('(軽)')) {
    tax.reduced = true;
    rest = rest.replace('(軽)', '');
  }
  const rate = rest.match(/(\d+)%/);
  if (rate) {
    tax.rate = Number(rate[1]);
    rest = rest.replace(rate[0], '');
  }
  rest = rest.replace(/\s+/g, '');
  tax.kind = TAX_KINDS.includes(rest) ? rest : (rest.includes('不明') ? '不明' : 'その他');
  return tax;
}

module.exports = { parseTax }; // node-only
