// Đọc sao kê ngân hàng để import.
// - Excel/CSV: đọc bằng code, nhưng vì mỗi ngân hàng một định dạng, ta đưa
//   toàn bộ nội dung text cho AI để nhận diện cột (ngày, nội dung, thu, chi).
// - PDF: gửi cho OpenAI đọc.
//
// Trả về danh sách dòng chuẩn hóa:
//   { tx_date (YYYY-MM-DD), description, direction ('in'|'out'), amount, error? }

import * as XLSX from 'xlsx'

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY || ''
const MODEL = 'gpt-4.1'

const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          tx_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          tx_time: {
            type: ['string', 'null'],
            description: 'Giờ giao dịch HH:MM:SS nếu sao kê có (vd 15:31:12), không có thì null',
          },
          counterparty: {
            type: ['string', 'null'],
            description: 'Tên tài khoản đối ứng (Remitter/Beneficiary account name), vd "cong ty co phan airpay"; không có thì null',
          },
          description: { type: ['string', 'null'] },
          direction: { type: 'string', enum: ['in', 'out'], description: 'in=tiền vào, out=tiền ra' },
          amount: { type: ['number', 'null'], description: 'số tiền dương, không dấu phân cách' },
        },
        required: ['tx_date', 'tx_time', 'counterparty', 'description', 'direction', 'amount'],
      },
    },
  },
  required: ['rows'],
}

async function callOpenAI(messages) {
  if (!OPENAI_KEY) throw new Error('Chưa cấu hình VITE_OPENAI_API_KEY')
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, temperature: 0, messages,
      response_format: { type: 'json_schema', json_schema: { name: 'statement', strict: true, schema } },
    }),
  })
  if (!r.ok) throw new Error(`OpenAI lỗi ${r.status}: ${(await r.text()).slice(0, 120)}`)
  const data = await r.json()
  return JSON.parse(data.choices[0].message.content)
}

const SYS =
  'Bạn đọc sao kê ngân hàng Việt Nam và trích từng dòng giao dịch. ' +
  'direction="in" nếu tiền VÀO tài khoản (cột Có/Credit), "out" nếu tiền RA (cột Nợ/Debit). ' +
  'amount là số dương, không dấu phân cách, không chữ. ' +
  'tx_date theo YYYY-MM-DD. QUAN TRỌNG: nếu sao kê có cột thời gian/ngày giờ thực hiện ' +
  '(vd "2026-10-31 15:31:12"), hãy tách GIỜ ra tx_time dạng HH:MM:SS — việc này cần ' +
  'để sắp đúng thứ tự các giao dịch trong cùng một ngày. Nếu không có giờ thì tx_time=null. ' +
  'counterparty là tên tài khoản đối ứng (Remitter/Beneficiary account name); không có thì null. ' +
  'Bỏ qua dòng tiêu đề, dòng tổng, dòng số dư đầu/cuối. Chỉ lấy giao dịch thật.'

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('Không đọc được file'))
    reader.readAsDataURL(file)
  })
}

function normRows(rows) {
  return (rows || []).map((r) => {
    const date = r.tx_date || ''
    // ghép ngày + giờ thành tx_at (ISO). Không có giờ -> 00:00:00.
    const time = /^\d{2}:\d{2}(:\d{2})?$/.test(r.tx_time || '') ? r.tx_time : null
    const tx_at = date ? `${date}T${time || '00:00:00'}` : null
    return {
      tx_date: date,
      tx_time: time || '',
      tx_at,
      counterparty: r.counterparty || '',
      description: r.description || '',
      direction: r.direction === 'out' ? 'out' : 'in',
      amount: Number(r.amount) || 0,
      error: (!date || !(Number(r.amount) > 0)) ? 'thiếu ngày hoặc số tiền' : null,
    }
  })
}

export async function readStatementExcel(file) {
  // đọc text bảng rồi đưa cho AI nhận diện cột (chịu được mọi định dạng NH)
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const csv = XLSX.utils.sheet_to_csv(ws)
  // cắt bớt nếu quá dài (an toàn token)
  const text = csv.slice(0, 60000)
  const out = await callOpenAI([
    { role: 'system', content: SYS },
    { role: 'user', content: `Đây là nội dung sao kê (CSV từ Excel). Trích các dòng giao dịch:\n\n${text}` },
  ])
  return normRows(out.rows)
}

export async function readStatementPDF(file) {
  const b64 = await fileToBase64(file)
  const out = await callOpenAI([
    { role: 'system', content: SYS },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Đọc sao kê PDF đính kèm, trích các dòng giao dịch.' },
        { type: 'file', file: { filename: file.name, file_data: `data:application/pdf;base64,${b64}` } },
      ],
    },
  ])
  return normRows(out.rows)
}

export async function readStatementFile(file) {
  const lower = file.name.toLowerCase()
  if (/\.(xlsx|xls|csv)$/.test(lower)) return readStatementExcel(file)
  if (lower.endsWith('.pdf')) return readStatementPDF(file)
  throw new Error('Chỉ nhận file Excel (.xlsx/.xls/.csv) hoặc PDF')
}
