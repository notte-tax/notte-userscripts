// 判定ルール。Journal[] → Finding[]。DOM には一切触らない
const { norm, dayNumber } = require('./util'); // node-only

const SEVERITY = { MUST: '修正必須', CHECK: '要確認', CONCERN: '懸念' };
const SEVERITY_ORDER = [SEVERITY.MUST, SEVERITY.CHECK, SEVERITY.CONCERN];

// 札の小窓の見出し
const RULE_TITLES = {
  R001: '税区分が不明',
  R022: '売上高の税区分',
  R028: '給与の税区分',
  R044: '受取利息の税区分',
  R068: 'インボイス経過措置の控除割合',
  R036: '10万円以上の消耗品費',
  R035: '20万円以上の修繕費',
  R054: '摘要と科目の不一致',
  'EX-摘要空欄': '摘要が空欄',
  R051: '重複候補（同じ日）',
  R052: '重複候補（近い日）',
  R055: '同じ摘要で科目が違う',
};

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
  add(index, 'R054', SEVERITY.CONCERN, `摘要に「${first.keyword}」とありますが、科目は「${side.item}」です（想定: ${first.expected.join('・')}）`,
    { check: '摘要と科目のどちらが正しいか', fix: `摘要が正しければ、科目を「${first.expected.join('」か「')}」にする` });
}

function checkSingle(journal, index, config, opts, add) {
  const changeDate = config.invoiceTransitionChangeDate;
  const sides = sidesOf(journal);
  for (const s of sides) {
    if (s.tax.kind === '不明' && !config.taxUnknownIgnoredItems.includes(s.item)) {
      add(index, 'R001', SEVERITY.MUST, `税区分が「不明」です（${s.item}）`,
        { check: 'その行の取引の内容', fix: '内容に合う税区分にする（経費なら「課仕 10%」、給与・保険料なら「対象外」など）' });
    }
    if (s.side === 'credit' && s.category === 'revenue' && s.item.includes('売上')) {
      if (s.tax.kind === '対象外') add(index, 'R022', SEVERITY.MUST, `売上高「${s.item}」に「対象外」が付いています`,
        { check: '売上の内容（国内の課税取引か、輸出か）', fix: '「課売 10%」にする。食品などの軽減税率なら「課売 (軽)8%」、輸出なら「免売」' });
      if (s.tax.kind === '非売') add(index, 'R022', SEVERITY.CHECK, `売上高「${s.item}」が非課税売上になっています。非課税取引か確認してください`,
        { check: '土地の貸付・住宅の家賃など、非課税の取引か', fix: '非課税でなければ「課売 10%」にする' });
    }
    if (s.side === 'debit' && config.salaryItems.includes(s.item) && s.tax.kind === '課仕'
      && !config.salaryTaxableKeywords.some((k) => norm(s.subItem).includes(k) || norm(s.remark).includes(k))) {
      add(index, 'R028', SEVERITY.MUST, `「${s.item}」に課税仕入の税区分が付いています。給与・法定福利費は不課税です`,
        { check: '通勤手当などの課税仕入が混ざっていないか', fix: '「対象外」にする' });
    }
    if (s.side === 'credit' && config.interestIncomeItems.includes(s.item) && s.tax.kind === '課売') {
      add(index, 'R044', SEVERITY.MUST, `「${s.item}」に課税売上の税区分が付いています。受取利息は非課税売上です`,
        { check: '受取利息か（ほかの収入が混ざっていないか）', fix: '「非売」にする' });
    }
    if (s.tax.deductionPct === 80 && journal.date && journal.date >= changeDate) {
      add(index, 'R068', SEVERITY.CHECK, `${changeDate.replace(/-/g, '/')}以降の取引に「80%控除」が残っています。経過措置の控除割合を確認してください`,
        { check: '相手がインボイス発行事業者でないか（登録番号の有無）', fix: `${changeDate.replace(/-/g, '/')}以降は「70%控除」の税区分にする（相手が登録済みなら通常の「課仕 10%」）` });
    }
    if (s.side === 'debit' && config.consumablesItems.includes(s.item) && s.amount >= config.consumablesThreshold) {
      add(index, 'R036', SEVERITY.CHECK, `${formatYen(s.amount)}円の消耗品費です。${formatYen(config.consumablesThreshold)}円以上なので資産計上（少額減価償却資産等）を検討してください`,
        {
          check: `1個（1組）あたりの金額が${formatYen(config.consumablesThreshold)}円以上か`,
          fix: `${formatYen(config.consumablesThreshold)}円以上なら資産に計上する（20万円未満なら一括償却資産、中小企業者等なら少額減価償却資産の特例も検討）`,
        });
    }
    if (s.side === 'debit' && config.repairItems.includes(s.item) && s.amount >= config.repairThreshold) {
      add(index, 'R035', SEVERITY.CONCERN, `${formatYen(s.amount)}円の修繕費です。資本的支出に当たらないか確認してください`,
        {
          check: '価値を高める・使える期間を延ばす支出か、元に戻すための支出か',
          fix: '価値を高める支出なら資産に計上する。60万円未満、または前期末の取得価額の10%以下なら、修繕費のままでよい形式基準もあるので確認する',
        });
    }
    if (s.side === 'debit' && s.category === 'expense') {
      checkRemarkKeywords(s, index, config, add);
    }
  }
  if (opts.checkEmptyRemark && sides.some((s) => s.category === 'expense') && journal.branches.every((b) => !b.remark)) {
    add(index, 'EX-摘要空欄', SEVERITY.CONCERN, '摘要が空欄です',
      { check: '何の支払いか（証憑）', fix: '摘要に支払先と内容を入れる' });
  }
}

// 借方科目の組・貸方科目の組・借方金額の合計
function signature(journal) {
  const sides = sidesOf(journal);
  const debit = sides.filter((s) => s.side === 'debit');
  const credit = sides.filter((s) => s.side === 'credit');
  const nameOf = (s) => (s.subItem ? `${s.item}(${s.subItem})` : s.item);
  return {
    key: `${debit.map(nameOf).sort().join('+')}|${credit.map(nameOf).sort().join('+')}`,
    total: debit.reduce((sum, s) => sum + s.amount, 0),
  };
}

// 仕訳の摘要（空でない行の摘要を ' / ' でつなぐ）
function remarkKeyOf(journal) {
  return journal.branches.map((b) => norm(b.remark)).filter((r) => r).join(' / ');
}

// 重複候補の案内用：相手の仕訳を1行で説明する
function describeJournal(journal) {
  const sides = sidesOf(journal);
  const names = (side) => [...new Set(sides.filter((s) => s.side === side).map((s) => s.item))].join('・');
  const parts = [];
  if (journal.date) parts.push(journal.date.slice(5).replace('-', '/'));
  parts.push(`${names('debit')}／${names('credit')}`);
  parts.push(`${formatYen(signature(journal).total)}円`);
  const remark = remarkKeyOf(journal);
  if (remark) parts.push(`摘要「${remark.length > 30 ? `${remark.slice(0, 30)}…` : remark}」`);
  return parts.join('　');
}

const DUP_GUIDE = { check: '通帳・証憑で、取引が本当に2回あったか', fix: '1回だけなら、片方の仕訳をMFで削除する' };

// R051・R052: 重複「候補」。断定はしない
function checkDuplicates(journals, config, add) {
  const list = journals
    .map((j, i) => ({ j, i }))
    .filter(({ j }) => !j.isOpening && j.date)
    .map((x) => ({ ...x, sig: signature(x.j), day: dayNumber(x.j.date), remark: remarkKeyOf(x.j) }));
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      const x = list[a];
      const y = list[b];
      if (x.sig.total < config.duplicateMinAmount || x.sig.key !== y.sig.key || x.sig.total !== y.sig.total) continue;
      if (x.remark && y.remark && x.remark !== y.remark) continue;
      const diff = Math.abs(x.day - y.day);
      if (diff === 0) {
        add(x.i, 'R051', SEVERITY.CHECK, `重複候補：No.${y.j.no}と同じ日・同じ金額・同じ科目です（${describeJournal(y.j)}）`, DUP_GUIDE);
        add(y.i, 'R051', SEVERITY.CHECK, `重複候補：No.${x.j.no}と同じ日・同じ金額・同じ科目です（${describeJournal(x.j)}）`, DUP_GUIDE);
      } else if (diff <= config.nearDuplicateDays) {
        add(x.i, 'R052', SEVERITY.CONCERN, `重複候補：No.${y.j.no}と近い日に同じ金額・同じ科目です（${describeJournal(y.j)}）`, DUP_GUIDE);
        add(y.i, 'R052', SEVERITY.CONCERN, `重複候補：No.${x.j.no}と近い日に同じ金額・同じ科目です（${describeJournal(x.j)}）`, DUP_GUIDE);
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
      add(i, 'R055', SEVERITY.CONCERN, `同じ摘要「${remark}」で科目が分かれています（${items}）`,
        { check: `どちらの科目が正しいか（${items}）`, fix: 'どちらかの科目にそろえる' });
    }
  }
}

function runRules(journals, config, options = {}) {
  const opts = { checkEmptyRemark: true, ...options };
  const findings = [];
  const seen = new Set();
  const add = (index, ruleId, severity, message, guide) => {
    const key = `${index}|${ruleId}|${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ journalIndex: index, journalNo: journals[index].no, ruleId, severity, message, check: guide.check, fix: guide.fix });
  };
  journals.forEach((j, i) => {
    if (!j.isOpening) checkSingle(j, i, config, opts, add);
  });
  checkDuplicates(journals, config, add);
  checkRemarkConsistency(journals, config, add);
  return findings;
}

module.exports = { SEVERITY, SEVERITY_ORDER, RULE_TITLES, sidesOf, runRules }; // node-only
