// ==UserScript==
// @name         notte MF仕訳帳チェック
// @namespace    https://github.com/notte-tax/notte-userscripts
// @version      0.1.1
// @description  MFクラウド会計の仕訳帳で、誤りの可能性が高い仕訳に色と理由を表示します（表示のみ・MFへの書き込みなし・外部通信なし）
// @author       税理士法人notte
// @match        https://accounting.moneyforward.com/books*
// @grant        none
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/notte-tax/notte-userscripts/main/dist/mf-journal-check.user.js
// @downloadURL  https://raw.githubusercontent.com/notte-tax/notte-userscripts/main/dist/mf-journal-check.user.js
// ==/UserScript==

(function () {
'use strict';

// ---- util.js ----
// 文字列・金額・日付の小さな道具

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function norm(s) {
  return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function parseAmount(s) {
  const m = norm(s).match(/-?\d[\d,]*/);
  if (!m) return 0;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// 'YYYY-MM-DD' → UTC の通算日（日数の差を取るため）
function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

// ---- tax.js ----
// MFの税区分の表記（例: "共-課仕 10%80%控除"）を構造化する

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
  const prefix = [...TAX_KINDS].sort((a, b) => b.length - a.length).find((k) => rest.startsWith(k));
  tax.kind = prefix || (rest.includes('不明') ? '不明' : 'その他');
  return tax;
}

// ---- config.js ----
// しきい値・科目名・キーワード表。ルールのコードには数字や科目名を直接書かず、ここだけを直す
const CONFIG = {
  consumablesThreshold: 100000,              // R036 消耗品費
  repairThreshold: 200000,                   // R035 修繕費
  nearDuplicateDays: 3,                      // R052 近い日の重複候補
  duplicateMinAmount: 1000,                  // R051・R052 この金額未満は比べない（振込手数料など）
  invoiceTransitionChangeDate: '2026-10-01', // R068 80%控除が終わる日
  minRemarkLength: 2,                        // R055 比べる摘要の最短文字数
  remarkStopWords: ['当月分', '前月分', '振込', '振込手数料', '手数料', '口座振替'],  // R055 で比べない摘要（完全一致）
  salaryItems: ['役員報酬', '給料手当', '給料', '賃金', '賞与', '役員賞与', '法定福利費', '退職金'],
  salaryTaxableKeywords: ['通勤'],  // R028 の対象外（通勤手当は課税仕入）
  interestIncomeItems: ['受取利息'],
  consumablesItems: ['消耗品費'],
  repairItems: ['修繕費'],
  remarkKeywords: [
    { keywords: ['電気', '電力', 'ガス', '水道'], expected: ['水道光熱費'] },
    { keywords: ['携帯', '電話', 'インターネット', 'プロバイダ', '切手', '郵便'], expected: ['通信費'] },
    { keywords: ['ガソリン', '高速', 'ETC', 'タクシー', 'JR', '航空'], expected: ['旅費交通費', '車両費'] },
    { keywords: ['家賃', '賃料'], expected: ['地代家賃'] },
  ],
};

// ---- reader.js ----
// MF 仕訳帳（/books）の表 → Journal[]。MF の画面のつくりを知っているのはこのファイルだけ

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

// ---- rules.js ----
// 判定ルール。Journal[] → Finding[]。DOM には一切触らない

const SEVERITY = { MUST: '修正必須', CHECK: '要確認', CONCERN: '懸念' };
const SEVERITY_ORDER = [SEVERITY.MUST, SEVERITY.CHECK, SEVERITY.CONCERN];

function formatYen(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 仕訳の借方・貸方を1列に並べる（どちら側か・その行の摘要つき）
function sidesOf(journal) {
  const out = [];
  journal.branches.forEach((b, branchIndex) => {
    if (b.debit) out.push({ ...b.debit, side: 'debit', remark: b.remark, branchIndex });
    if (b.credit) out.push({ ...b.credit, side: 'credit', remark: b.remark, branchIndex });
  });
  return out;
}

// R054: 摘要に言葉があり、その言葉が想定する科目のどれにも当たらない
function checkRemarkKeywords(side, index, config, add) {
  const remark = norm(side.remark).toUpperCase();
  if (!remark) return;
  const matched = [];
  for (const group of config.remarkKeywords) {
    const keyword = group.keywords.find((k) => remark.includes(norm(k).toUpperCase()));
    if (keyword) matched.push({ keyword, expected: group.expected });
  }
  if (matched.length === 0) return;
  if (matched.some((m) => m.expected.includes(side.item))) return;
  const first = matched[0];
  add(index, 'R054', SEVERITY.CONCERN, `摘要に「${first.keyword}」とありますが、科目は「${side.item}」です（想定: ${first.expected.join('・')}）`);
}

function checkSingle(journal, index, config, opts, add) {
  const changeDate = config.invoiceTransitionChangeDate;
  const sides = sidesOf(journal);
  for (const s of sides) {
    if (s.tax.kind === '不明') {
      add(index, 'R001', SEVERITY.MUST, `税区分が「不明」です（${s.item}）`);
    }
    if (s.side === 'credit' && s.category === 'revenue' && s.item.includes('売上')) {
      if (s.tax.kind === '対象外') add(index, 'R022', SEVERITY.MUST, `売上高「${s.item}」に「対象外」が付いています`);
      if (s.tax.kind === '非売') add(index, 'R022', SEVERITY.CHECK, `売上高「${s.item}」が非課税売上になっています。非課税取引か確認してください`);
    }
    if (s.side === 'debit' && config.salaryItems.includes(s.item) && s.tax.kind === '課仕'
      && !config.salaryTaxableKeywords.some((k) => norm(s.subItem).includes(k) || norm(s.remark).includes(k))) {
      add(index, 'R028', SEVERITY.MUST, `「${s.item}」に課税仕入の税区分が付いています。給与・法定福利費は不課税です`);
    }
    if (s.side === 'credit' && config.interestIncomeItems.includes(s.item) && s.tax.kind === '課売') {
      add(index, 'R044', SEVERITY.MUST, `「${s.item}」に課税売上の税区分が付いています。受取利息は非課税売上です`);
    }
    if (s.tax.deductionPct === 80 && journal.date && journal.date >= changeDate) {
      add(index, 'R068', SEVERITY.CHECK, `${changeDate.replace(/-/g, '/')}以降の取引に「80%控除」が残っています。経過措置の控除割合を確認してください`);
    }
    if (s.side === 'debit' && config.consumablesItems.includes(s.item) && s.amount >= config.consumablesThreshold) {
      add(index, 'R036', SEVERITY.CHECK, `${formatYen(s.amount)}円の消耗品費です。${formatYen(config.consumablesThreshold)}円以上なので資産計上（少額減価償却資産等）を検討してください`);
    }
    if (s.side === 'debit' && config.repairItems.includes(s.item) && s.amount >= config.repairThreshold) {
      add(index, 'R035', SEVERITY.CONCERN, `${formatYen(s.amount)}円の修繕費です。資本的支出に当たらないか確認してください`);
    }
    if (s.side === 'debit' && s.category === 'expense') {
      checkRemarkKeywords(s, index, config, add);
    }
  }
  if (opts.checkEmptyRemark && sides.some((s) => s.category === 'expense') && journal.branches.every((b) => !b.remark)) {
    add(index, 'EX-摘要空欄', SEVERITY.CONCERN, '摘要が空欄です');
  }
}

// 借方科目の組・貸方科目の組・借方金額の合計
function signature(journal) {
  const sides = sidesOf(journal);
  const debit = sides.filter((s) => s.side === 'debit');
  const credit = sides.filter((s) => s.side === 'credit');
  return {
    key: `${debit.map((s) => s.item).sort().join('+')}|${credit.map((s) => s.item).sort().join('+')}`,
    total: debit.reduce((sum, s) => sum + s.amount, 0),
  };
}

// R051・R052: 重複「候補」。断定はしない
function checkDuplicates(journals, config, add) {
  const list = journals
    .map((j, i) => ({ j, i }))
    .filter(({ j }) => !j.isOpening && j.date)
    .map((x) => ({ ...x, sig: signature(x.j), day: dayNumber(x.j.date) }));
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      const x = list[a];
      const y = list[b];
      if (x.sig.total < config.duplicateMinAmount || x.sig.key !== y.sig.key || x.sig.total !== y.sig.total) continue;
      const diff = Math.abs(x.day - y.day);
      if (diff === 0) {
        add(x.i, 'R051', SEVERITY.CHECK, `重複候補：No.${y.j.no}と同じ日・同じ金額・同じ科目です`);
        add(y.i, 'R051', SEVERITY.CHECK, `重複候補：No.${x.j.no}と同じ日・同じ金額・同じ科目です`);
      } else if (diff <= config.nearDuplicateDays) {
        add(x.i, 'R052', SEVERITY.CONCERN, `重複候補：No.${y.j.no}と近い日に同じ金額・同じ科目です`);
        add(y.i, 'R052', SEVERITY.CONCERN, `重複候補：No.${x.j.no}と近い日に同じ金額・同じ科目です`);
      }
    }
  }
}

// R055: 同じ摘要なのに費用の借方科目が分かれている
function checkRemarkConsistency(journals, config, add) {
  const groups = new Map();
  journals.forEach((j, i) => {
    if (j.isOpening) return;
    for (const s of sidesOf(j)) {
      if (s.side !== 'debit' || s.category !== 'expense') continue;
      const remark = norm(s.remark);
      if (remark.length < config.minRemarkLength) continue;
      if (config.remarkStopWords.some((w) => norm(w) === remark)) continue;
      if (!groups.has(remark)) groups.set(remark, { items: new Set(), indexes: new Set() });
      groups.get(remark).items.add(s.item);
      groups.get(remark).indexes.add(i);
    }
  });
  for (const [remark, g] of groups) {
    if (g.items.size < 2) continue;
    const items = [...g.items].join('／');
    for (const i of g.indexes) {
      add(i, 'R055', SEVERITY.CONCERN, `同じ摘要「${remark}」で科目が分かれています（${items}）`);
    }
  }
}

function runRules(journals, config, options = {}) {
  const opts = { checkEmptyRemark: true, ...options };
  const findings = [];
  const seen = new Set();
  const add = (index, ruleId, severity, message) => {
    const key = `${index}|${ruleId}|${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ journalIndex: index, journalNo: journals[index].no, ruleId, severity, message });
  };
  journals.forEach((j, i) => {
    if (!j.isOpening) checkSingle(j, i, config, opts, add);
  });
  checkDuplicates(journals, config, add);
  checkRemarkConsistency(journals, config, add);
  return findings;
}

// ---- overlay.js ----
// 画面への表示（色帯・札・集計パネル）。判定はしない

const COLORS = { '修正必須': '#C62828', '要確認': '#A85A2E', '懸念': '#8A6D00' };
const SEV_CLASS = { '修正必須': 'must', '要確認': 'check', '懸念': 'concern' };
const SETTINGS_KEY = 'notte-jc-settings';
const DEFAULT_SETTINGS = { enabled: true, checkEmptyRemark: true, collapsed: false };
const PANEL_Z_INDEX = 99999;
const jumpCursors = {};

function loadSettings(storage) {
  try {
    const raw = storage ? storage.getItem(SETTINGS_KEY) : null;
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(storage, settings) {
  try {
    if (storage) storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    // 保存できない環境（プライベートウィンドウ等）でも初期値で動けばよい
  }
}

function injectStyles(doc) {
  if (doc.getElementById('njc-style')) return;
  const style = doc.createElement('style');
  style.id = 'njc-style';
  const sevCss = SEVERITY_ORDER.map((sev) => {
    const c = COLORS[sev];
    const k = SEV_CLASS[sev];
    return `td.njc-band-${k}{box-shadow:inset 4px 0 0 ${c};}`
      + `.njc-badge-${k}{color:${c};border-color:${c};}`
      + `#njc-panel .njc-count-${k}{color:${c};border-color:${c};}`;
  }).join('\n');
  style.textContent = `${sevCss}
.njc-badges{display:flex;flex-wrap:wrap;gap:2px;margin-top:2px;}
.njc-badge{display:inline-block;padding:0 4px;border:1px solid;border-radius:3px;background:#fff;font:600 11px/16px sans-serif;white-space:nowrap;cursor:help;}
tr.njc-flash>td{outline:2px solid #4a76b0;outline-offset:-2px;}
#njc-panel{position:fixed;top:56px;right:16px;z-index:${PANEL_Z_INDEX};max-width:calc(100vw - 32px);min-width:180px;padding:8px 10px;background:#fff;color:#1f2933;border:1px solid #c9d3da;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);font:12px/1.5 sans-serif;}
#njc-panel .njc-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;}
#njc-panel .njc-fold{border:none;background:none;cursor:pointer;color:#4a76b0;font-size:12px;}
#njc-panel .njc-counts{display:flex;flex-wrap:wrap;gap:4px;}
#njc-panel .njc-count{padding:1px 6px;border:1px solid;border-radius:4px;background:#fff;font:600 12px/18px sans-serif;cursor:pointer;}
#njc-panel .njc-count:disabled{opacity:.5;cursor:default;}
#njc-panel .njc-total,#njc-panel .njc-off{color:#5B7079;margin-top:4px;}
#njc-panel .njc-error{color:#C62828;max-width:240px;}
#njc-panel label{display:block;margin-top:4px;cursor:pointer;}
@media (max-width:600px){#njc-panel .njc-extra{display:none;}}`;
  doc.head.appendChild(style);
}

function worstOf(list) {
  return SEVERITY_ORDER.find((sev) => list.some((f) => f.severity === sev));
}

function applyMarks(journals, findings) {
  const byJournal = new Map();
  for (const f of findings) {
    if (!byJournal.has(f.journalIndex)) byJournal.set(f.journalIndex, []);
    byJournal.get(f.journalIndex).push(f);
  }
  for (const [index, list] of byJournal) {
    const first = journals[index].rows[0];
    if (!first) continue;
    const doc = first.ownerDocument;
    injectStyles(doc);
    const bandCell = first.cells[0];
    bandCell.classList.add(`njc-band-${SEV_CLASS[worstOf(list)]}`);
    first.setAttribute('data-njc-severities', SEVERITY_ORDER.filter((sev) => list.some((f) => f.severity === sev)).join(' '));

    const byRule = new Map();
    for (const f of list) {
      if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, []);
      byRule.get(f.ruleId).push(f);
    }
    const box = doc.createElement('div');
    box.className = 'njc-badges';
    for (const [ruleId, fs] of byRule) {
      const badge = doc.createElement('span');
      badge.className = `njc-badge njc-badge-${SEV_CLASS[worstOf(fs)]}`;
      badge.textContent = ruleId;
      badge.title = fs.map((f) => `【${f.severity}】${f.message}`).join('\n');
      box.appendChild(badge);
    }
    (first.querySelector(SELECTORS.options) || bandCell).appendChild(box);
  }
}

function clearMarks(doc) {
  doc.querySelectorAll('.njc-badges').forEach((e) => e.remove());
  doc.querySelectorAll('[class*="njc-band-"]').forEach((e) => {
    [...e.classList].filter((c) => c.startsWith('njc-band-')).forEach((c) => e.classList.remove(c));
  });
  doc.querySelectorAll('[data-njc-severities]').forEach((e) => e.removeAttribute('data-njc-severities'));
}

function countBySeverity(findings) {
  const counts = {};
  for (const sev of SEVERITY_ORDER) {
    counts[sev] = new Set(findings.filter((f) => f.severity === sev).map((f) => f.journalIndex)).size;
  }
  return counts;
}

function jumpTo(doc, severity) {
  const rows = [...doc.querySelectorAll(`tr[data-njc-severities~="${severity}"]`)];
  if (rows.length === 0) return;
  const next = ((jumpCursors[severity] ?? -1) + 1) % rows.length;
  jumpCursors[severity] = next;
  const tr = rows[next];
  if (tr.scrollIntoView) tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
  tr.classList.add('njc-flash');
  setTimeout(() => tr.classList.remove('njc-flash'), 1500);
}

function renderPanel(doc, view, handlers) {
  injectStyles(doc);
  let panel = doc.getElementById('njc-panel');
  if (!panel) {
    panel = doc.createElement('div');
    panel.id = 'njc-panel';
    doc.body.appendChild(panel);
  }
  panel.textContent = '';
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const { settings } = view;

  const head = el('div', 'njc-head');
  head.appendChild(el('strong', null, 'notte 仕訳チェック'));
  const fold = el('button', 'njc-fold', settings.collapsed ? '▼' : '▲');
  fold.type = 'button';
  fold.title = settings.collapsed ? '開く' : '折りたたむ';
  fold.addEventListener('click', handlers.onToggleCollapsed);
  head.appendChild(fold);
  panel.appendChild(head);

  if (view.state === 'error') {
    panel.appendChild(el('div', 'njc-error', 'MFの画面が変わったため、チェックできません（notte-userscripts の更新を待ってください）'));
  } else if (view.state === 'empty') {
    panel.appendChild(el('div', 'njc-off', 'このページに読み取れる仕訳がありません'));
  } else if (view.state === 'off') {
    panel.appendChild(el('div', 'njc-off', 'チェックはオフです'));
  } else {
    const counts = el('div', 'njc-counts');
    for (const sev of SEVERITY_ORDER) {
      const b = el('button', `njc-count njc-count-${SEV_CLASS[sev]}`, `${sev} ${view.counts[sev]}`);
      b.type = 'button';
      b.setAttribute('data-severity', sev);
      b.disabled = view.counts[sev] === 0;
      b.title = 'クリックで次の該当行へ移動';
      b.addEventListener('click', () => jumpTo(doc, sev));
      counts.appendChild(b);
    }
    panel.appendChild(counts);
    panel.appendChild(el('div', 'njc-total njc-extra', `このページ ${view.total}件中`));
  }

  if (settings.collapsed) return panel;
  const toggle = (name, label, checked, onChange) => {
    const wrap = el('label', 'njc-extra');
    const input = el('input');
    input.type = 'checkbox';
    input.name = name;
    input.checked = checked;
    input.addEventListener('change', onChange);
    wrap.appendChild(input);
    wrap.appendChild(doc.createTextNode(` ${label}`));
    panel.appendChild(wrap);
  };
  toggle('enabled', 'チェックする', settings.enabled, handlers.onToggleEnabled);
  toggle('checkEmptyRemark', '摘要の空欄も知らせる', settings.checkEmptyRemark, handlers.onToggleEmptyRemark);
  return panel;
}

// ---- main.js ----
// 起動と、表の入れ替わり（ページ送り・絞り込み・並べ替え）の検知

const OBSERVE_OPTIONS = { childList: true, subtree: true };

function isBooksPage(loc) {
  return loc.pathname.replace(/\/+$/, '') === '/books';
}

// 表に関係する変化か（MF のツールチップ等、表の外の変化では再チェックしない）
function isRelevantMutation(m) {
  const t = m.target;
  if (t.nodeType === 1 && t.closest('#njc-panel')) return false;
  if (t.nodeType === 1 && t.closest('table')) return true;
  return [...m.addedNodes, ...m.removedNodes].some((n) => n.nodeType === 1 && (n.matches('table, tbody, tr') || n.querySelector('tbody')));
}

function start(win) {
  const doc = win.document;
  let storage = null;
  try { storage = win.localStorage; } catch (e) { storage = null; }
  let settings = loadSettings(storage);
  let timer = null;

  const observer = new win.MutationObserver((mutations) => {
    if (mutations.some(isRelevantMutation)) schedule();
  });
  function schedule() {
    win.clearTimeout(timer);
    timer = win.setTimeout(run, 300);
  }
  function update(patch) {
    settings = { ...settings, ...patch };
    saveSettings(storage, settings);
    run();
  }
  const handlers = {
    onToggleEnabled: () => update({ enabled: !settings.enabled }),
    onToggleEmptyRemark: () => update({ checkEmptyRemark: !settings.checkEmptyRemark }),
    onToggleCollapsed: () => update({ collapsed: !settings.collapsed }),
  };

  function run() {
    // 自分の書き換えで再チェックが起きないよう、作業中は監視を止める
    observer.disconnect();
    try {
      clearMarks(doc);
      if (!isBooksPage(win.location)) {
        const panel = doc.getElementById('njc-panel');
        if (panel) panel.remove();
        return;
      }
      const tbody = doc.querySelector(SELECTORS.tbody);
      if (!tbody) {
        const panel = doc.getElementById('njc-panel');
        if (panel) panel.remove();
        return;
      }
      if (!settings.enabled) {
        renderPanel(doc, { state: 'off', settings }, handlers);
        return;
      }
      let journals;
      try {
        journals = readJournals(tbody, readPeriod(win.location.search, doc));
      } catch (e) {
        if (!(e instanceof ReaderError)) throw e;
        renderPanel(doc, { state: 'error', settings }, handlers);
        return;
      }
      if (journals.length === 0) {
        renderPanel(doc, { state: 'empty', settings }, handlers);
        return;
      }
      const findings = runRules(journals, CONFIG, { checkEmptyRemark: settings.checkEmptyRemark });
      applyMarks(journals, findings);
      renderPanel(doc, { state: 'ok', settings, counts: countBySeverity(findings), total: journals.length }, handlers);
    } finally {
      observer.observe(doc.body, OBSERVE_OPTIONS);
    }
  }

  run();
}

start(window);
})();
