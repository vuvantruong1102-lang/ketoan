// Đọc file "Bảng kê chi tiết hóa đơn đã sử dụng" (hóa đơn ĐẦU RA) từ phần mềm HĐĐT.
// File là CHI TIẾT TỪNG DÒNG HÀNG; nhiều dòng cùng một số hóa đơn.
// Ta gom các dòng theo (Ký hiệu + Số HĐ) thành từng hóa đơn, mỗi hóa đơn có nhiều dòng.
//
// Cột cố định (0-based sau khi đọc bằng sheet_to_json header:1):
//   1=Ký hiệu, 2=Số HĐ, 3=Ngày HĐ(dd/mm/yyyy), 5=Tên KH, 11=MST,
//   15=Mã hàng(SKU), 16=Tên hàng, 24=SL, 25=Đơn giá, 29=Thuế suất(%),
//   26=Thành tiền, 30=Tiền thuế GTGT, 31=Tổng tiền TT

import * as XLSX from 'xlsx'

const COL = {
  symbol: 1, no: 2, date: 3, cust_name: 5, mst: 11,
  sku: 15, name: 16, qty: 24, price: 25, vat_rate: 29,
  amount: 26, tax: 30, total: 31,
}

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

function vatRate(v) {
  // "8%" -> 8, 0 -> 0
  const n = toNum(v)
  return [0, 5, 8, 10].includes(n) ? n : null
}

function toISO(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

// Đọc file, trả về danh sách HÓA ĐƠN đã gom dòng:
// { key, symbol, invoice_no, invoice_date, cust_name, mst, has_mst,
//   items: [{ sku, name, qty, price, vat_rate, amount, tax, total }],
//   sum_amount, sum_tax, sum_total }
export async function parseOutputInvoices(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false })

  // tìm dòng tiêu đề: dòng có ô = 'STT' ở cột 0
  let headerRow = -1
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (String(rows[i][0] || '').trim().toUpperCase() === 'STT') { headerRow = i; break }
  }
  if (headerRow === -1) throw new Error('Không tìm thấy dòng tiêu đề (STT) — sai định dạng file.')

  const map = new Map()  // key -> invoice
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    const no = row[COL.no]
    if (no == null || String(no).trim() === '') continue  // bỏ dòng trống
    const symbol = String(row[COL.symbol] || '').trim()
    const key = `${symbol}|${String(no).trim()}`
    if (!map.has(key)) {
      const mst = String(row[COL.mst] || '').trim()
      map.set(key, {
        key, symbol, invoice_no: String(no).trim(),
        invoice_date: toISO(row[COL.date]),
        cust_name: String(row[COL.cust_name] || '').trim(),
        mst, has_mst: !!mst,
        items: [], sum_amount: 0, sum_tax: 0, sum_total: 0,
      })
    }
    const inv = map.get(key)
    const tax = toNum(row[COL.tax])
    const total = toNum(row[COL.total])      // Tổng tiền TT (AF) — số cuối cùng
    // Tiền hàng (chưa thuế) = Tổng tiền TT − Tiền thuế GTGT (theo đúng công thức yêu cầu).
    // KHÔNG dùng cột "Thành tiền" (AA) vì nó trước chiết khấu, không khớp.
    const amount = total - tax
    inv.items.push({
      sku: String(row[COL.sku] || '').trim(),
      name: String(row[COL.name] || '').trim(),
      qty: toNum(row[COL.qty]) || 1,
      price: toNum(row[COL.price]),
      vat_rate: vatRate(row[COL.vat_rate]),
      amount, tax, total,
    })
    inv.sum_amount += amount
    inv.sum_tax += tax
    inv.sum_total += total
  }
  return Array.from(map.values())
}
