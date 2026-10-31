// Đọc hóa đơn từ file để import hàng loạt.
// - XML: đọc bằng code trong trình duyệt (chính xác, miễn phí).
// - PDF: gửi cho OpenAI (gpt-4.1) đọc.
//
// Mọi hàm trả về cùng một dạng "ParsedInvoice" để bảng kê dùng chung:
// {
//   fileName, source: 'xml' | 'pdf',
//   invoice_no, invoice_date (YYYY-MM-DD),
//   seller_name, seller_tax_code, seller_address,
//   buyer_name, buyer_tax_code,
//   amount_before_tax, tax_amount, amount_total,
//   items: [{ name, quantity, unit_price, vat_rate, amount, tax }],
//   error: string | null
// }

const OPENAI_MODEL = 'gpt-4.1'

// ---------- Tiện ích ----------
function toNum(v) {
  if (v == null) return null
  // bỏ dấu phân cách nghìn kiểu VN "1.234.567,89" hoặc "1,234,567.89"
  let s = String(v).trim().replace(/[^\d.,-]/g, '')
  if (!s) return null
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    // có cả , và . -> dấu đứng sau cùng là thập phân, dấu kia là phân cách nghìn
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (lastComma > -1) {
    // chỉ có phẩy: phân cách nghìn nếu nhóm cuối đúng 3 số, else thập phân
    s = s.replace(/,/g, (s.length - lastComma - 1 === 3 ? '' : '.'))
  } else if (lastDot > -1) {
    // chỉ có chấm: phân cách nghìn nếu có >1 chấm HOẶC nhóm cuối đúng 3 số
    const dots = (s.match(/\./g) || []).length
    if (dots > 1 || s.length - lastDot - 1 === 3) s = s.replace(/\./g, '')
    // ngược lại giữ nguyên (vd "1234.5" là thập phân)
  }
  const n = Number(s)
  return isNaN(n) ? null : n
}

function normVatRate(v) {
  const n = toNum(v)
  if (n == null) return null
  if ([0, 5, 8, 10].includes(n)) return n
  // "KCT"/"KKKNT"/text -> null (không rõ)
  return null
}

function toISODate(v) {
  if (!v) return null
  const s = String(v).trim()
  // dd/mm/yyyy
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // yyyy-mm-dd (có thể kèm giờ)
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

// ---------- XML ----------
// Hóa đơn điện tử VN theo chuẩn TCT: thẻ nằm trong <HDon><DLHDon><NDHDon>...
// Ta dò theo tên thẻ phổ biến, không phụ thuộc thứ tự, để chịu được nhiều mẫu.
function tagText(node, names) {
  for (const name of names) {
    const el = node.getElementsByTagName(name)[0]
    if (el && el.textContent != null && el.textContent.trim() !== '') {
      return el.textContent.trim()
    }
  }
  return null
}

export function parseInvoiceXML(xmlText, fileName) {
  const base = {
    fileName, source: 'xml',
    invoice_no: null, invoice_date: null,
    seller_name: null, seller_tax_code: null, seller_address: null,
    buyer_name: null, buyer_tax_code: null,
    amount_before_tax: null, tax_amount: null, amount_total: null,
    items: [], error: null,
  }
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) {
      return { ...base, error: 'XML không hợp lệ' }
    }
    // Thông tin chung
    base.invoice_no = tagText(doc, ['SHDon', 'Shdon', 'InvoiceNumber'])
    base.invoice_date = toISODate(tagText(doc, ['NLap', 'Nlap', 'InvoiceDate']))

    // Người bán: thẻ nhóm NBan
    const nban = doc.getElementsByTagName('NBan')[0] || doc
    base.seller_name = tagText(nban, ['Ten', 'TenNBan', 'SellerName'])
    base.seller_tax_code = tagText(nban, ['MST', 'MSTNBan', 'SellerTaxCode'])
    base.seller_address = tagText(nban, ['DChi', 'DiaChiNBan', 'SellerAddress'])

    // Người mua: thẻ nhóm NMua
    const nmua = doc.getElementsByTagName('NMua')[0]
    if (nmua) {
      base.buyer_name = tagText(nmua, ['Ten', 'TenNMua', 'BuyerName'])
      base.buyer_tax_code = tagText(nmua, ['MST', 'MSTNMua', 'BuyerTaxCode'])
    }

    // Tổng tiền
    base.amount_before_tax = toNum(tagText(doc, ['TgTCThue', 'TongTienChuaThue']))
    base.tax_amount = toNum(tagText(doc, ['TgTThue', 'TongTienThue']))
    base.amount_total = toNum(tagText(doc, ['TgTTTBSo', 'TongTienThanhToan']))

    // Dòng hàng: mỗi <HHDVu> là một dòng
    const rows = doc.getElementsByTagName('HHDVu')
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      base.items.push({
        name: tagText(r, ['THHDVu', 'TenHHDVu']) || `Mục ${i + 1}`,
        quantity: toNum(tagText(r, ['SLuong', 'SoLuong'])) ?? 1,
        unit_price: toNum(tagText(r, ['DGia', 'DonGia'])) ?? 0,
        vat_rate: normVatRate(tagText(r, ['TSuat', 'ThueSuat'])),
        amount: toNum(tagText(r, ['ThTien', 'ThanhTien'])),
        tax: toNum(tagText(r, ['TThue'])),
      })
    }
    if (base.items.length === 0) {
      base.items.push({ name: 'Hàng hóa/dịch vụ', quantity: 1,
        unit_price: base.amount_before_tax ?? 0, vat_rate: null,
        amount: base.amount_before_tax, tax: base.tax_amount })
    }
    return base
  } catch (e) {
    return { ...base, error: 'Lỗi đọc XML: ' + e.message }
  }
}

// ---------- PDF qua OpenAI ----------
const pdfSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    invoice_no: { type: ['string', 'null'] },
    invoice_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    seller_name: { type: ['string', 'null'] },
    seller_tax_code: { type: ['string', 'null'] },
    seller_address: { type: ['string', 'null'] },
    buyer_name: { type: ['string', 'null'] },
    buyer_tax_code: { type: ['string', 'null'] },
    amount_before_tax: { type: ['number', 'null'] },
    tax_amount: { type: ['number', 'null'] },
    amount_total: { type: ['number', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit_price: { type: ['number', 'null'] },
          vat_rate: { type: ['number', 'null'] },
          amount: { type: ['number', 'null'] },
          tax: { type: ['number', 'null'] },
        },
        required: ['name', 'quantity', 'unit_price', 'vat_rate', 'amount', 'tax'],
      },
    },
  },
  required: [
    'invoice_no', 'invoice_date', 'seller_name', 'seller_tax_code', 'seller_address',
    'buyer_name', 'buyer_tax_code', 'amount_before_tax', 'tax_amount', 'amount_total', 'items',
  ],
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('Không đọc được file'))
    reader.readAsDataURL(file)
  })
}

export async function parseInvoicePDF(file, apiKey) {
  const base = {
    fileName: file.name, source: 'pdf',
    invoice_no: null, invoice_date: null,
    seller_name: null, seller_tax_code: null, seller_address: null,
    buyer_name: null, buyer_tax_code: null,
    amount_before_tax: null, tax_amount: null, amount_total: null,
    items: [], error: null,
  }
  if (!apiKey) return { ...base, error: 'Chưa cấu hình OpenAI API key' }
  try {
    const b64 = await fileToBase64(file)
    const body = {
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Bạn đọc hóa đơn GTGT Việt Nam và trích xuất theo schema. Số tiền trả về ' +
            'dạng số thuần (vd 1500000, không dấu phân cách, không chữ "đ"). Ngày YYYY-MM-DD. ' +
            'Thuế suất chỉ nhận 0, 5, 8, 10; nếu khác thì null. Thiếu trường nào trả null.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Đọc hóa đơn PDF đính kèm, trả JSON theo schema.' },
            {
              type: 'file',
              file: {
                filename: file.name,
                file_data: `data:application/pdf;base64,${b64}`,
              },
            },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'invoice', strict: true, schema: pdfSchema },
      },
    }
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      const t = await r.text()
      return { ...base, error: `OpenAI lỗi ${r.status}: ${t.slice(0, 120)}` }
    }
    const data = await r.json()
    const content = data?.choices?.[0]?.message?.content
    const inv = JSON.parse(content)
    return {
      ...base,
      invoice_no: inv.invoice_no, invoice_date: toISODate(inv.invoice_date),
      seller_name: inv.seller_name, seller_tax_code: inv.seller_tax_code,
      seller_address: inv.seller_address,
      buyer_name: inv.buyer_name, buyer_tax_code: inv.buyer_tax_code,
      amount_before_tax: toNum(inv.amount_before_tax),
      tax_amount: toNum(inv.tax_amount),
      amount_total: toNum(inv.amount_total),
      items: (inv.items || []).map((it) => ({
        name: it.name || 'Mục',
        quantity: toNum(it.quantity) ?? 1,
        unit_price: toNum(it.unit_price) ?? 0,
        vat_rate: normVatRate(it.vat_rate),
        amount: toNum(it.amount),
        tax: toNum(it.tax),
      })),
    }
  } catch (e) {
    return { ...base, error: 'Lỗi đọc PDF: ' + e.message }
  }
}

// Đọc một file bất kỳ (tự nhận loại theo đuôi)
export async function parseInvoiceFile(file, apiKey) {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.xml')) {
    const text = await file.text()
    return parseInvoiceXML(text, file.name)
  }
  if (lower.endsWith('.pdf')) {
    return parseInvoicePDF(file, apiKey)
  }
  return {
    fileName: file.name, source: 'unknown', items: [],
    error: 'Chỉ nhận file .pdf hoặc .xml',
  }
}
