// Định dạng tiền VND: làm tròn về số nguyên đồng khi hiển thị.
export function vnd(n) {
  const v = Number(n || 0)
  return Math.round(v).toLocaleString('vi-VN') + ' ₫'
}

// Số thường (số lượng) — giữ tối đa 2 chữ số lẻ, bỏ số 0 thừa.
export function num(n) {
  const v = Number(n || 0)
  return v.toLocaleString('vi-VN', { maximumFractionDigits: 2 })
}

// Ngày: yyyy-mm-dd -> dd/mm/yyyy
export function dmy(d) {
  if (!d) return ''
  const [y, m, day] = String(d).slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}

// Từ một ngày suy ra quý
export function quarterOf(dateStr) {
  const d = new Date(dateStr)
  return Math.floor(d.getMonth() / 3) + 1
}

export function yearOf(dateStr) {
  return new Date(dateStr).getFullYear()
}

// Danh sách năm gần đây để chọn trong bộ lọc
export function recentYears(count = 4) {
  const y = new Date().getFullYear()
  return Array.from({ length: count }, (_, i) => y - i)
}
