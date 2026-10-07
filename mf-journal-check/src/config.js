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

module.exports = { CONFIG }; // node-only
