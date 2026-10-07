// 2026-10-07 に確認した MF 仕訳帳（/books）の表のつくりをまねた架空データ。
// 実在の顧問先名・口座番号は入れない。金額は6桁以下にする。

const BOOKS_URL = 'https://accounting.moneyforward.com/books?recognized_at_from=2025%2F09%2F01&recognized_at_to=2026%2F08%2F31&page=1&per_page=200';

function sideCells(side, s) {
  const t = (id) => `ca-client-test-child-journal-branch-side-${side}-${id}`;
  const cat = s ? s.category : 'none';
  return [
    `<td class="td___x1 col-item-and-sub-item___aa1"><div><div><div class="table-text-padding___p1 item-style-${cat}___h1" data-testid="${t('item')}">${s ? s.item : ''}</div></div></div><div><div class="table-text-padding___p1" data-testid="${t('sub-item')}">${(s && s.subItem) || ''}</div></div></td>`,
    `<td class="td___x1 col-dept-and-trade-partner___aa2"><div data-testid="${t('trade-partner')}">${(s && s.partner) || ''}</div></td>`,
    `<td class="td___x2 col-excise-and-invoice___aa3"><div><div><div class="table-text-padding___p2" data-testid="${t('excise')}">${s ? s.tax : ''}</div></div></div><div><div class="table-text-padding___p2" data-testid="${t('invoice')}"></div></div></td>`,
    `<td class="td___x1 col-amount___aa4"><div data-testid="${t('amount')}">${s ? s.amount : ''}</div></td>`,
  ].join('');
}

function makeRowsHtml(journals) {
  return journals.map((j) => j.branches.map((b, k) => {
    const n = j.branches.length;
    const head = k === 0
      ? `<td class="col-journal-number___n1" rowspan="${n}"><span data-testid="ca-client-test-child-journal-journal-number">${j.no}</span></td><td class="col-recognized-at___d1" rowspan="${n}">${j.dateText}</td>`
      : '';
    const tail = k === 0
      ? `<td class="col-options___o1" rowspan="${n}"></td><td class="col-edit___e1" rowspan="${n}">編集</td><td class="col-menu___m1" rowspan="${n}"></td>`
      : '';
    const id = k === 0 ? 'first-row' : 'row';
    return `<tr class="tr___r1 odd___r2" data-testid="ca-client-test-child-journal-${id}">${head}${sideCells('debit', b.debit)}${sideCells('credit', b.credit)}<td class="td___x1 col-remark___rm1">${b.remark || ''}</td>${tail}</tr>`;
  }).join('')).join('');
}

function makeBooksHtml(journals) {
  return `<table class="table___t1"><thead><tr><th>取引No</th></tr></thead><tbody data-testid="ca-client-test-child-tbody">${makeRowsHtml(journals)}</tbody></table>`;
}

const SAMPLE = [
  {
    no: '1', dateText: '09/01開始仕訳',
    branches: [
      { debit: { item: '普通預金', category: 'asset', tax: '対象外', amount: '50,000' },
        credit: { item: '資本金', category: 'capital', tax: '対象外', amount: '50,000' }, remark: '' },
    ],
  },
  {
    no: '2', dateText: '10/15',
    branches: [
      { debit: { item: '消耗品費', category: 'expense', tax: '課仕 10%', amount: '120,000', partner: 'テスト商店' },
        credit: { item: '普通預金', category: 'asset', tax: '対象外', amount: '120,000' }, remark: 'プリンター購入' },
    ],
  },
  {
    no: '3', dateText: '03/31',
    branches: [
      { debit: { item: '給料手当', category: 'expense', tax: '課仕 10%', amount: '200,000' },
        credit: { item: '普通預金', category: 'asset', tax: '対象外', amount: '180,000' }, remark: '3月分給与' },
      { debit: null,
        credit: { item: '預り金', subItem: '所得税', category: 'liability', tax: '対象外', amount: '20,000' }, remark: '3月分給与' },
    ],
  },
];

module.exports = { BOOKS_URL, makeRowsHtml, makeBooksHtml, SAMPLE };
