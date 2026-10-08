// 起動と、表の入れ替わり（ページ送り・絞り込み・並べ替え）の検知
const { CONFIG } = require('./config'); // node-only
const { SELECTORS, ReaderError, readPeriod, readJournals } = require('./reader'); // node-only
const { runRules } = require('./rules'); // node-only
const { loadSettings, saveSettings, applyMarks, clearMarks, countBySeverity, renderPanel } = require('./overlay'); // node-only

const OBSERVE_OPTIONS = { childList: true, subtree: true };

function isBooksPage(loc) {
  return loc.pathname.replace(/\/+$/, '') === '/books';
}

// 表に関係する変化か（MF のツールチップ等、表の外の変化では再チェックしない）
function isRelevantMutation(m) {
  const t = m.target;
  if (t.nodeType === 1 && t.closest('#njc-panel, #njc-details')) return false;
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

module.exports = { start }; // node-only
