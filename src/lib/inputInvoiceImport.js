// Đọc file "Bảng kê hóa đơn đầu vào" (dịch vụ) từ phần mềm HĐĐT.
// File ở MỨC HÓA ĐƠN: mỗi dòng = 1 hóa đơn, có tổng tiền hàng + tiền thuế.
// KHÔNG có chi tiết dòng hàng / SKU -> chỉ dùng để tính VAT đầu vào + chi phí.
//
// Cột (1-based): D=Ngày HĐ, F=Số HĐ, G=Tên NCC, H=MST,
//   I=Tổng tiền hàng (chưa thuế), J=Tiền thuế GTGT, K=Tổng tiền TT

import * as XLSX from 'xlsx'

const COL = { date: 4, no: 6, seller: 7, mst: 8, amount: 9, tax: 10, total: 11 }

function toNum(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(/[^\d.,-]/g, '')
  if (!s) return 0
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.')
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (lc > -1) s = s.replace(/,/g, (s.length - lc - 1 === 3 ? '' : '.'))
  else if (ld > -1) { const d = (s.match(/\./g) || []).length; if (d > 1 || s.length - ld - 1 === 3) s = s.replace(/\./g, '') }
  const n = Number(s); return isNaN(n) ? 0 : n
}

function pad(n) { return String(n).padStart(2, '0') }

function toISO(v) {
  if (v == null || v === '') return null
  // Date object (do cellDates) — lấy theo ngày địa phương, tránh lệch múi giờ
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  }
  // số serial của Excel (phòng khi cellDates không bắt)
  if (typeof v === 'number' && v > 59 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  return null
}

// Trả về danh sách hóa đơn:
// { invoice_no, invoice_date, seller_name, mst, amount, tax, total }
export async function parseInputInvoices(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false })

  // tìm dòng tiêu đề (ô A = 'STT')
  let headerRow = -1
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (String(rows[i][0] || '').trim().toUpperCase() === 'STT') { headerRow = i; break }
  }
  if (headerRow === -1) throw new Error('Không tìm thấy dòng tiêu đề (STT) — sai định dạng file.')

  const out = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    const no = row[COL.no - 1]
    if (no == null || String(no).trim() === '') continue
    out.push({
      invoice_no: String(no).trim(),
      invoice_date: toISO(row[COL.date - 1]),
      seller_name: String(row[COL.seller - 1] || '').trim(),
      mst: String(row[COL.mst - 1] || '').trim(),
      amount: toNum(row[COL.amount - 1]),
      tax: toNum(row[COL.tax - 1]),
      total: toNum(row[COL.total - 1]),
    })
  }
  return out
}
