// MF 仕訳帳（/books）の表 → Journal[]。MF の画面のつくりを知っているのはこのファイルだけ
const { norm, parseAmount } = require('./util'); // node-only
const { parseTax } = require('./tax'); // node-only

const SELECTORS = {
  tbody: 'tbody[data-testid="ca-client-test-child-tbody"]',
  firstRowId: 'ca-client-test-child-journal-first-row',
  rowId: 'ca-client-test-child-journal-row',
  number: '[data-testid="ca-client-test-child-journal-journal-number"]',
  date: 'td[class*="col-recognized-at"]',
  remark: 'td[class*="col-remark"]',
  options: 'td[class*="col-options"]',
};

class ReaderError extends Error {}

function toIso(s) {
  const m = norm(s).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

function readPeriod(search, doc) {
  const params = new URLSearchParams(search || '');
  let from = toIso(params.get('recognized_at_from') || '');
  let to = toIso(params.get('recognized_at_to') || '');
  if ((!from || !to) && doc) {
    const values = [...doc.querySelectorAll('input')].map((i) => toIso(i.value)).filter(Boolean);
    if (values.length >= 2) {
      from = from || values[0];
      to = to || values[1];
    }
  }
  return from && to && from <= to ? { from, to } : null;
}

// "10/15" に、期間の中に収まる年を補う。候補が1つでなければ null
function resolveDate(text, period) {
  const m = norm(text).match(/(\d{1,2})\/(\d{1,2})/);
  if (!m || !period) return null;
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');
  const hits = [];
  for (let y = Number(period.from.slice(0, 4)); y <= Number(period.to.slice(0, 4)); y++) {
    const iso = `${y}-${mm}-${dd}`;
    if (iso >= period.from && iso <= period.to) hits.push(iso);
  }
  return hits.length === 1 ? hits[0] : null;
}

// 借方・貸方の片側。目印が無ければ undefined（画面が変わった）、科目が空なら null
function readSide(tr, side) {
  const q = (field) => tr.querySelector(`[data-testid="ca-client-test-child-journal-branch-side-${side}-${field}"]`);
  const text = (field) => norm(q(field) && q(field).textContent);
  const itemEl = q('item');
  if (!itemEl) return undefined;
  const style = [...itemEl.classList].find((c) => c.startsWith('item-style-'));
  const category = style ? style.replace(/^item-style-/, '').replace(/___.*$/, '') : 'none';
  const item = norm(itemEl.textContent);
  if (category === 'none' && !item) return null;
  return {
    item,
    subItem: text('sub-item'),
    partner: text('trade-partner'),
    category,
    tax: parseTax(text('excise')),
    amount: parseAmount(text('amount')),
  };
}

function readJournals(tbody, period) {
  const journals = [];
  let current = null;
  for (const tr of tbody.querySelectorAll('tr')) {
    const id = tr.getAttribute('data-testid');
    if (id === SELECTORS.firstRowId) {
      const numberEl = tr.querySelector(SELECTORS.number);
      const dateEl = tr.querySelector(SELECTORS.date);
      if (!numberEl || !dateEl) throw new ReaderError('journal number or date column not found');
      const dateText = norm(dateEl.textContent);
      current = { no: norm(numberEl.textContent), date: resolveDate(dateText, period), isOpening: dateText.includes('開始'), branches: [], rows: [] };
      journals.push(current);
    } else if (id !== SELECTORS.rowId || !current) {
      continue;
    }
    const debit = readSide(tr, 'debit');
    const credit = readSide(tr, 'credit');
    if (debit === undefined || credit === undefined) throw new ReaderError('debit/credit columns not found');
    const remarkEl = tr.querySelector(SELECTORS.remark);
    current.branches.push({ debit, credit, remark: norm(remarkEl && remarkEl.textContent) });
    current.rows.push(tr);
  }
  return journals;
}

module.exports = { SELECTORS, ReaderError, readPeriod, resolveDate, readJournals }; // node-only
