// 判定ルール。Journal[] → Finding[]。DOM には一切触らない
const { norm, dayNumber } = require('./util'); // node-only

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

function checkSingle(journal, index, config, opts, add) {
  const changeDate = config.invoiceTransitionChangeDate;
  for (const s of sidesOf(journal)) {
    if (s.tax.kind === '不明') {
      add(index, 'R001', SEVERITY.MUST, `税区分が「不明」です（${s.item}）`);
    }
    if (s.side === 'credit' && s.category === 'revenue' && s.item.includes('売上')) {
      if (s.tax.kind === '対象外') add(index, 'R022', SEVERITY.MUST, `売上高「${s.item}」に「対象外」が付いています`);
      if (s.tax.kind === '非売') add(index, 'R022', SEVERITY.CHECK, `売上高「${s.item}」が非課税売上になっています。非課税取引か確認してください`);
    }
    if (s.side === 'debit' && config.salaryItems.includes(s.item) && s.tax.kind === '課仕') {
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
  return findings;
}

module.exports = { SEVERITY, SEVERITY_ORDER, sidesOf, runRules }; // node-only
