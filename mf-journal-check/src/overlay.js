// 画面への表示（色帯・札・集計パネル）。判定はしない
const { SEVERITY_ORDER, RULE_TITLES } = require('./rules'); // node-only
const { SELECTORS } = require('./reader'); // node-only

const COLORS = { '修正必須': '#C62828', '要確認': '#A85A2E', '懸念': '#8A6D00' };
const SEV_CLASS = { '修正必須': 'must', '要確認': 'check', '懸念': 'concern' };
const SETTINGS_KEY = 'notte-jc-settings';
const DEFAULT_SETTINGS = { enabled: true, checkEmptyRemark: true, collapsed: false };
const PANEL_Z_INDEX = 99999;
const jumpCursors = {};
const badgeFindings = new WeakMap();
const detailsOwners = new WeakMap();
const detailsListenedDocs = new WeakSet();

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
.njc-badge{display:inline-block;padding:0 4px;border:1px solid;border-radius:3px;background:#fff;font:600 11px/16px sans-serif;white-space:nowrap;cursor:pointer;}
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
#njc-details{position:fixed;max-width:380px;box-sizing:border-box;padding:8px 10px;background:#fff;color:#1f2933;border:1px solid #c9d3da;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.2);font:12px/1.6 sans-serif;}
#njc-details .njc-d-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px;font-weight:600;}
#njc-details .njc-d-close{border:none;background:none;cursor:pointer;color:#5B7079;font-size:12px;}
#njc-details .njc-d-row{display:grid;grid-template-columns:6.5em 1fr;column-gap:8px;}
#njc-details .njc-d-row+.njc-d-row{margin-top:4px;}
#njc-details .njc-d-text{min-width:0;overflow-wrap:anywhere;}
#njc-details .njc-d-label{color:#5B7079;font-weight:600;}
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
      badgeFindings.set(badge, { ruleId, findings: fs });
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = doc.getElementById('njc-details');
        const wasOwn = existing && detailsOwners.get(existing) === badge;
        closeDetails(doc);
        if (!wasOwn) openDetails(doc, badge, ruleId, fs);
      });
      box.appendChild(badge);
    }
    (first.querySelector(SELECTORS.options) || bandCell).appendChild(box);
  }
}

function closeDetails(doc) {
  const box = doc.getElementById('njc-details');
  if (box) box.remove();
}

function openDetails(doc, badge, ruleId, findings) {
  injectStyles(doc);
  closeDetails(doc);
  if (!detailsListenedDocs.has(doc)) {
    detailsListenedDocs.add(doc);
    doc.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.nodeType === 1 && (t.closest('#njc-details') || t.closest('.njc-badge'))) return;
      closeDetails(doc);
    });
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDetails(doc);
    });
  }
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const worst = worstOf(findings);
  const box = el('div');
  box.id = 'njc-details';
  box.style.zIndex = String(PANEL_Z_INDEX);
  const head = el('div', 'njc-d-head');
  const title = el('span', null, `${ruleId} ${RULE_TITLES[ruleId] || ''}（${worst}）`);
  title.style.color = COLORS[worst];
  head.appendChild(title);
  const close = el('button', 'njc-d-close', '✕');
  close.type = 'button';
  close.title = '閉じる';
  close.addEventListener('click', () => closeDetails(doc));
  head.appendChild(close);
  box.appendChild(head);
  const uniq = (key) => [...new Set(findings.map((f) => f[key]).filter((t) => t != null && t !== ''))];
  const body = el('div', 'njc-d-body');
  const addRow = (label, texts) => {
    const row = el('div', 'njc-d-row');
    row.appendChild(el('span', 'njc-d-label', label));
    const value = el('div', 'njc-d-text');
    texts.forEach((t) => value.appendChild(el('div', 'njc-d-line', t)));
    row.appendChild(value);
    body.appendChild(row);
  };
  if (uniq('message').length) addRow('問題', uniq('message'));
  uniq('check').forEach((t) => addRow('確認すること', [t]));
  uniq('fix').forEach((t) => addRow('訂正案', [t]));
  box.appendChild(body);
  detailsOwners.set(box, badge);
  doc.body.appendChild(box);

  const win = doc.defaultView;
  const rect = badge.getBoundingClientRect();
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  const left = Math.max(8, Math.min(rect.left, win.innerWidth - width - 8));
  let top = rect.bottom + 4;
  if (top + height > win.innerHeight && rect.top - 4 - height >= 0) top = rect.top - 4 - height;
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

function clearMarks(doc) {
  closeDetails(doc);
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

module.exports = { COLORS, SETTINGS_KEY, DEFAULT_SETTINGS, loadSettings, saveSettings, applyMarks, clearMarks, countBySeverity, renderPanel, openDetails, closeDetails }; // node-only
