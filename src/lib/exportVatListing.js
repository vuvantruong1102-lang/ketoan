import * as XLSX from 'xlsx'

// Xuất "BẢNG KÊ HOÁ ĐƠN, CHỨNG TỪ CỦA HÀNG HOÁ, DỊCH VỤ MUA VÀO"
// theo mẫu PL 01-1/GTGT (đi kèm tờ khai 01/GTGT).
//
// Dữ liệu vào: danh sách hóa đơn MUA VÀO trong kỳ, mỗi hóa đơn gồm
//   { invoice_no, invoice_date (YYYY-MM-DD), seller_name, seller_tax_code,
//     amount_before_tax, deductible_tax, vat_deductible (bool) }
//
// Phân nhóm theo mẫu:
//   - Nhóm 1: hóa đơn đủ điều kiện khấu trừ  (vat_deductible = true)
//   - Nhóm 4: hóa đơn KHÔNG đủ điều kiện khấu trừ (vat_deductible = false)
//   (Nhóm 2, 3 là trường hợp đặc thù — để trống.)

const COLS = 16 // A..P

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// tạo 1 hàng mảng rỗng đúng số cột
const emptyRow = () => Array(COLS).fill(null)

export function exportVatPurchaseListing(invoices, { year, quarter } = {}) {
  // chuẩn hóa + chia nhóm
  const norm = invoices.map((r) => ({
    invoice_no: r.invoice_no || '',
    invoice_date: r.invoice_date,
    seller_name: r.seller_name || '',
    seller_tax_code: r.seller_tax_code || '',
    before: Number(r.amount_before_tax || 0),
    tax: Number(r.deductible_tax || 0),
    deductible: r.vat_deductible !== false,
  }))
  const g1 = norm.filter((r) => r.deductible)
  const g4 = norm.filter((r) => !r.deductible)

  const aoa = []
  const merges = []
  let R = 0 // chỉ số hàng hiện tại (0-based) để ghi merge

  // --- Tiêu đề ---
  const title = emptyRow()
  title[0] = 'BẢNG KÊ HOÁ ĐƠN, CHỨNG TỪ CỦA HÀNG HOÁ, DỊCH VỤ MUA VÀO'
  aoa.push(emptyRow())            // hàng 1 trống (như mẫu A2)
  aoa.push(title); R = 1
  merges.push({ s: { r: R, c: 0 }, e: { r: R, c: 13 } }) // A..N
  // kỳ kê khai
  const period = emptyRow()
  period[0] = year && quarter ? `Kỳ tính thuế: Quý ${quarter}/${year}` : ''
  aoa.push(period); R++
  merges.push({ s: { r: R, c: 0 }, e: { r: R, c: 13 } })

  // --- Header bảng (2 dòng, có merge) ---
  const h1 = emptyRow(), h2 = emptyRow()
  h1[0] = 'STT'
  h1[1] = 'Hóa đơn, chứng từ, biên lai nộp thuế'   // B..D merge
  h1[4] = 'Tên người bán'                           // E..G merge
  h1[7] = 'Mã số thuế người bán'
  h1[8] = 'Giá trị HHDV mua vào chưa có thuế'
  h1[9] = 'Thuế GTGT đủ điều kiện khấu trừ thuế'
  h1[10] = 'Ghi chú'
  h2[1] = 'Số hóa đơn'
  h2[2] = 'Ngày, tháng, năm lập hóa đơn'            // C..D merge
  const hr1 = aoa.push(h1) - 1
  const hr2 = aoa.push(h2) - 1
  // merges cho header
  merges.push({ s: { r: hr1, c: 0 }, e: { r: hr2, c: 0 } })  // STT dọc
  merges.push({ s: { r: hr1, c: 1 }, e: { r: hr1, c: 3 } })  // Hóa đơn...
  merges.push({ s: { r: hr1, c: 4 }, e: { r: hr2, c: 6 } })  // Tên người bán
  merges.push({ s: { r: hr1, c: 7 }, e: { r: hr2, c: 7 } })  // MST
  merges.push({ s: { r: hr1, c: 8 }, e: { r: hr2, c: 8 } })  // Giá trị
  merges.push({ s: { r: hr1, c: 9 }, e: { r: hr2, c: 9 } })  // Thuế
  merges.push({ s: { r: hr1, c: 10 }, e: { r: hr2, c: 10 } }) // Ghi chú
  merges.push({ s: { r: hr2, c: 2 }, e: { r: hr2, c: 3 } })  // Ngày...

  // helper: ghi 1 nhóm, trả về {sumBefore, sumTax}
  function writeGroup(sectionTitle, rows) {
    const sec = emptyRow(); sec[0] = sectionTitle
    const rSec = aoa.push(sec) - 1
    merges.push({ s: { r: rSec, c: 0 }, e: { r: rSec, c: COLS - 1 } })
    let sb = 0, st = 0
    rows.forEach((r, i) => {
      const row = emptyRow()
      row[0] = i + 1
      row[1] = r.invoice_no
      row[2] = fmtDate(r.invoice_date)   // C..D merge mỗi dòng
      row[4] = r.seller_name             // E..G merge mỗi dòng
      row[7] = r.seller_tax_code
      row[8] = r.before
      row[9] = r.tax
      const rr = aoa.push(row) - 1
      merges.push({ s: { r: rr, c: 2 }, e: { r: rr, c: 3 } })
      merges.push({ s: { r: rr, c: 4 }, e: { r: rr, c: 6 } })
      sb += r.before; st += r.tax
    })
    return { sb, st }
  }

  const t1 = writeGroup(
    '1. Hàng hóa, dịch vụ dùng riêng cho SXKD chịu thuế GTGT và sử dụng cho các hoạt động cung cấp hàng hóa, dịch vụ không kê khai, nộp thuế GTGT đủ điều kiện khấu trừ thuế:',
    g1)
  // tổng nhóm 1
  {
    const row = emptyRow(); row[0] = 'Tổng nhóm 1'; row[8] = t1.sb; row[9] = t1.st
    const rr = aoa.push(row) - 1
    merges.push({ s: { r: rr, c: 0 }, e: { r: rr, c: 7 } })
  }

  // Nhóm 2, 3 (để trống cho đủ mẫu)
  for (const [t, label] of [
    ['2', '2. Hàng hóa, dịch vụ dùng chung cho SXKD chịu thuế và không chịu thuế đủ điều kiện khấu trừ thuế:'],
    ['3', '3. Hàng hóa, dịch vụ dùng cho dự án đầu tư đủ điều kiện được khấu trừ thuế (*):'],
  ]) {
    const sec = emptyRow(); sec[0] = label
    const rSec = aoa.push(sec) - 1
    merges.push({ s: { r: rSec, c: 0 }, e: { r: rSec, c: COLS - 1 } })
    const row = emptyRow(); row[0] = `Tổng nhóm ${t}`; row[8] = 0; row[9] = 0
    const rr = aoa.push(row) - 1
    merges.push({ s: { r: rr, c: 0 }, e: { r: rr, c: 7 } })
  }

  const t4 = writeGroup('4. Hàng hóa, dịch vụ không đủ điều kiện được khấu trừ:', g4)
  {
    const row = emptyRow(); row[0] = 'Tổng nhóm 4'; row[8] = t4.sb; row[9] = t4.st
    const rr = aoa.push(row) - 1
    merges.push({ s: { r: rr, c: 0 }, e: { r: rr, c: 7 } })
  }

  // --- Khối tổng hợp cuối ---
  const totalBefore = t1.sb + t4.sb
  const totalDeductTax = t1.st // chỉ nhóm đủ điều kiện mới được khấu trừ
  const summary = [
    ['Tổng giá trị hàng hóa, dịch vụ mua vào:', totalBefore],
    ['Tổng giá trị hàng hóa, dịch vụ nhập khẩu:', 0],
    ['Tổng thuế GTGT của hàng hóa, dịch vụ mua vào:', totalDeductTax + t4.st],
    ['Tổng thuế GTGT của HHDV mua vào đủ điều kiện được khấu trừ (***):', totalDeductTax],
  ]
  for (const [label, val] of summary) {
    const row = emptyRow(); row[0] = label; row[8] = val
    const rr = aoa.push(row) - 1
    merges.push({ s: { r: rr, c: 0 }, e: { r: rr, c: 7 } })
  }

  // --- Tạo sheet ---
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!merges'] = merges
  ws['!cols'] = [
    { wch: 5 }, { wch: 16 }, { wch: 9 }, { wch: 4 }, { wch: 6 },
    { wch: 18 }, { wch: 4 }, { wch: 17 }, { wch: 20 }, { wch: 18 },
    { wch: 16 }, { wch: 4 }, { wch: 4 }, { wch: 4 }, { wch: 18 }, { wch: 18 },
  ]
  // định dạng số (cột I=8, J=9) cho các ô số
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (const c of [8, 9]) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (cell && typeof cell.v === 'number') cell.z = '#,##0'
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'BK mua vao')
  const fname = year && quarter
    ? `bang_ke_mua_vao_Q${quarter}_${year}.xlsx`
    : 'bang_ke_mua_vao.xlsx'
  XLSX.writeFile(wb, fname)
}

// =====================================================================
// Xuất "BẢNG KÊ HOÁ ĐƠN, CHỨNG TỪ HÀNG HOÁ, DỊCH VỤ BÁN RA" (PL 01-2/GTGT)
// Dữ liệu vào: hóa đơn BÁN RA trong kỳ, mỗi hóa đơn:
//   { invoice_no, invoice_date, buyer_name, buyer_tax_code,
//     amount_before_tax (doanh thu chưa thuế), tax_amount, vat_rate }
// Phân nhóm theo thuế suất:
//   nhóm 1: không chịu thuế, nhóm 2: 0%, nhóm 3: 5%, nhóm 4: thuế suất khác (8/10%)
// =====================================================================
const SALE_COLS = 11 // A..K

export function exportVatSaleListing(invoices, { year, quarter } = {}) {
  const norm = invoices.map((r) => ({
    invoice_no: r.invoice_no || '',
    invoice_date: r.invoice_date,
    buyer_name: r.buyer_name || '',
    buyer_tax_code: r.buyer_tax_code || '',
    before: Number(r.amount_before_tax || 0),
    tax: Number(r.tax_amount || 0),
    rate: r.vat_rate == null ? null : Number(r.vat_rate),
  }))

  // phân nhóm theo thuế suất
  const g = { notax: [], zero: [], five: [], other: [] }
  for (const r of norm) {
    if (r.rate === 0) g.zero.push(r)
    else if (r.rate === 5) g.five.push(r)
    else if (r.rate === 8 || r.rate === 10) g.other.push(r)
    else g.notax.push(r)  // null hoặc khác -> coi là không chịu thuế
  }

  const aoa = []
  const merges = []
  const emptyRow = () => Array(SALE_COLS).fill(null)
  const fmtDate = (iso) => {
    if (!iso) return ''
    const [y, m, d] = String(iso).slice(0, 10).split('-')
    return `${d}/${m}/${y}`
  }

  // tiêu đề
  aoa.push(emptyRow())
  const title = emptyRow()
  title[0] = 'BẢNG KÊ HOÁ ĐƠN, CHỨNG TỪ HÀNG HOÁ, DỊCH VỤ BÁN RA'
  aoa.push(title)
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 8 } })
  const period = emptyRow()
  period[0] = year && quarter ? `Kỳ tính thuế: Quý ${quarter}/${year}` : ''
  aoa.push(period)
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 8 } })

  // header bảng (2 dòng)
  const h1 = emptyRow(), h2 = emptyRow()
  h1[0] = 'STT'
  h1[1] = 'Hóa đơn, chứng từ bán ra'  // B..C
  h1[3] = 'Tên người mua'             // D..E
  h1[5] = 'Mã số thuế người mua'
  h1[6] = 'Doanh thu chưa có thuế GTGT'
  h1[7] = 'Thuế GTGT'
  h1[8] = 'Ghi chú'
  h2[1] = 'Số hóa đơn'
  h2[2] = 'Ngày, tháng, năm lập hóa đơn'
  const hr1 = aoa.push(h1) - 1
  const hr2 = aoa.push(h2) - 1
  merges.push({ s: { r: hr1, c: 0 }, e: { r: hr2, c: 0 } })
  merges.push({ s: { r: hr1, c: 1 }, e: { r: hr1, c: 2 } })
  merges.push({ s: { r: hr1, c: 3 }, e: { r: hr2, c: 4 } })
  merges.push({ s: { r: hr1, c: 5 }, e: { r: hr2, c: 5 } })
  merges.push({ s: { r: hr1, c: 6 }, e: { r: hr2, c: 6 } })
  merges.push({ s: { r: hr1, c: 7 }, e: { r: hr2, c: 7 } })
  merges.push({ s: { r: hr1, c: 8 }, e: { r: hr2, c: 8 } })

  function writeGroup(title, rows) {
    const sec = emptyRow(); sec[0] = title
    const rSec = aoa.push(sec) - 1
    merges.push({ s: { r: rSec, c: 0 }, e: { r: rSec, c: SALE_COLS - 1 } })
    let sb = 0, st = 0
    rows.forEach((r, i) => {
      const row = emptyRow()
      row[0] = i + 1
      row[1] = r.invoice_no
      row[2] = fmtDate(r.invoice_date)
      row[3] = r.buyer_name
      row[5] = r.buyer_tax_code
      row[6] = r.before
      row[7] = r.tax
      const rr = aoa.push(row) - 1
      merges.push({ s: { r: rr, c: 3 }, e: { r: rr, c: 4 } })
      sb += r.before; st += r.tax
    })
    const tot = emptyRow()
    tot[0] = 'Tổng'; tot[6] = sb; tot[7] = st
    const rt = aoa.push(tot) - 1
    merges.push({ s: { r: rt, c: 0 }, e: { r: rt, c: 5 } })
    return { sb, st }
  }

  const t1 = writeGroup('1. Hàng hóa, dịch vụ không chịu thuế giá trị gia tăng (GTGT):', g.notax)
  const t2 = writeGroup('2. Hàng hóa, dịch vụ chịu thuế suất thuế GTGT 0%:', g.zero)
  const t3 = writeGroup('3. Hàng hóa, dịch vụ chịu thuế suất thuế GTGT 5%:', g.five)
  const t4 = writeGroup('4. Hàng hóa, dịch vụ chịu thuế suất thuế GTGT khác (8%, 10%):', g.other)

  // tổng cuối
  const totRev = t1.sb + t2.sb + t3.sb + t4.sb
  const totTax = t1.st + t2.st + t3.st + t4.st
  const s1 = emptyRow(); s1[0] = 'Tổng doanh thu hàng hóa, dịch vụ bán ra:'; s1[6] = totRev
  const rs1 = aoa.push(s1) - 1; merges.push({ s: { r: rs1, c: 0 }, e: { r: rs1, c: 5 } })
  const s2 = emptyRow(); s2[0] = 'Tổng số thuế GTGT của hàng hóa, dịch vụ bán ra:'; s2[7] = totTax
  const rs2 = aoa.push(s2) - 1; merges.push({ s: { r: rs2, c: 0 }, e: { r: rs2, c: 6 } })

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!merges'] = merges
  ws['!cols'] = [
    { wch: 5 }, { wch: 15 }, { wch: 13 }, { wch: 10 }, { wch: 22 },
    { wch: 15 }, { wch: 19 }, { wch: 17 }, { wch: 20 }, { wch: 4 }, { wch: 4 },
  ]
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (const c of [6, 7]) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (cell && typeof cell.v === 'number') cell.z = '#,##0'
    }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'BK ban ra')
  const fname = year && quarter ? `bang_ke_ban_ra_Q${quarter}_${year}.xlsx` : 'bang_ke_ban_ra.xlsx'
  XLSX.writeFile(wb, fname)
}
