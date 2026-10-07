// 文字列・金額・日付の小さな道具

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function norm(s) {
  return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function parseAmount(s) {
  const digits = norm(s).replace(/[^\d-]/g, '');
  const n = Number(digits);
  return digits && Number.isFinite(n) ? n : 0;
}

// 'YYYY-MM-DD' → UTC の通算日（日数の差を取るため）
function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

module.exports = { norm, parseAmount, dayNumber }; // node-only
