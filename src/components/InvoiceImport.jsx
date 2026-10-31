import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal, Alert } from './ui'
import { vnd, dmy } from '../lib/format'
import { parseInvoiceFile } from '../lib/invoiceImport'

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY || ''

// Thông tin doanh nghiệp (người mua hợp lệ). MST là chuẩn chính để đối chiếu.
const OWN_TAX_CODE = (import.meta.env.VITE_OWN_TAX_CODE || '2400883385').replace(/\s/g, '')

// số tiền có dấu chấm ngăn cách nghìn, ví dụ 85.922.222
function money(n) {
  return Math.round(Number(n || 0)).toLocaleString('vi-VN')
}

// Hóa đơn hợp lệ khi MST người mua = MST doanh nghiệp.
function checkValid(buyerTax) {
  const t = String(buyerTax || '').replace(/\s/g, '')
  return t && t === OWN_TAX_CODE
}

// Mỗi dòng bảng kê = 1 hóa đơn đã đọc, có thể sửa trước khi ghi sổ.
// Mặc định: hóa đơn mua, dịch vụ, được khấu trừ (theo yêu cầu).
function toRow(parsed) {
  const beforeTax = parsed.amount_before_tax ?? 0
  const tax = parsed.tax_amount ?? 0
  return {
    fileName: parsed.fileName,
    source: parsed.source,
    parseError: parsed.error || null,
    // các trường sửa được
    invoice_no: parsed.invoice_no || '',
    invoice_date: parsed.invoice_date || new Date().toISOString().slice(0, 10),
    seller_name: parsed.seller_name || '',
    seller_tax_code: parsed.seller_tax_code || '',
    seller_address: parsed.seller_address || '',
    buyer_name: parsed.buyer_name || '',
    buyer_tax_code: parsed.buyer_tax_code || '',
    category: 'service',        // mặc định dịch vụ (ẩn, vẫn dùng khi ghi sổ)
    vat_deductible: true,       // mặc định được khấu trừ (ẩn, vẫn dùng khi ghi sổ)
    amount_before_tax: beforeTax,
    tax_amount: tax,
    // giữ lại dòng hàng gốc để tạo invoice_items
    items: parsed.items || [],
    // trạng thái ghi sổ
    status: parsed.error ? 'error' : 'ready',   // ready | saving | done | error
    saveError: null,
    include: !parsed.error,     // có tick để ghi sổ không
  }
}

export default function InvoiceImport({ partners, onClose, onDone }) {
  const [rows, setRows] = useState([])        // bảng kê
  const [busy, setBusy] = useState(false)     // đang đọc file
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState('')
  const [savingAll, setSavingAll] = useState(false)
  const fileRef = useRef()

  async function onFiles(fileList) {
    setErr('')
    // Lưu ý: fileList là tham chiếu "sống" tới input.files. Phải chuyển sang
    // mảng NGAY (trước khi input bị reset ở nơi gọi), nếu không sẽ thành rỗng.
    const all = Array.from(fileList || [])
    const files = all.filter((f) =>
      /\.(pdf|xml)$/i.test(f.name) ||
      f.type === 'application/pdf' ||
      f.type === 'text/xml' || f.type === 'application/xml'
    )
    if (files.length === 0) {
      setErr(all.length === 0
        ? 'Chưa chọn được file nào. Hãy chọn file rồi bấm Open.'
        : 'File đã chọn không phải .pdf hoặc .xml.')
      return
    }
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name))
    if (pdfs.length > 0 && !OPENAI_KEY) {
      setErr('Có file PDF nhưng chưa cấu hình VITE_OPENAI_API_KEY. XML vẫn đọc được.')
    }
    setBusy(true)
    const out = []
    for (let i = 0; i < files.length; i++) {
      setProgress(`Đang đọc ${i + 1}/${files.length}: ${files[i].name}`)
      // đọc tuần tự để không bắn quá nhiều request OpenAI cùng lúc
      // eslint-disable-next-line no-await-in-loop
      const parsed = await parseInvoiceFile(files[i], OPENAI_KEY)
      out.push(toRow(parsed))
      setRows([...out])   // cập nhật dần để người dùng thấy tiến độ
    }
    setBusy(false)
    setProgress('')
  }

  function patchRow(idx, patch) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function removeRow(idx) {
    setRows((rs) => rs.filter((_, i) => i !== idx))
  }

  // dò đối tác theo MST (bỏ khoảng trắng). Trả id hoặc null.
  function matchPartner(taxCode) {
    if (!taxCode) return null
    const t = taxCode.replace(/\s/g, '')
    const f = partners.find((p) => (p.tax_code || '').replace(/\s/g, '') === t)
    return f ? f.id : null
  }

  async function ensurePartner(row) {
    // có sẵn -> dùng; chưa có -> tạo mới nhà cung cấp từ thông tin đọc được
    const existing = matchPartner(row.seller_tax_code)
    if (existing) return existing
    const payload = {
      name: row.seller_name || '(chưa rõ tên)',
      tax_code: row.seller_tax_code || null,
      address: row.seller_address || null,
      is_supplier: true, is_customer: false,
    }
    const { data, error } = await supabase.from('partners').insert(payload).select('id').single()
    if (error) throw new Error('Tạo NCC lỗi: ' + error.message)
    return data.id
  }

  async function saveRow(idx) {
    const row = rows[idx]
    patchRow(idx, { status: 'saving', saveError: null })
    try {
      const partnerId = await ensurePartner(row)
      // đầu hóa đơn
      const { data: inv, error: e1 } = await supabase.from('invoices').insert({
        direction: 'in',
        invoice_no: row.invoice_no || null,
        invoice_date: row.invoice_date,
        partner_id: partnerId,
        category: row.category,
        vat_deductible: row.category === 'service' || row.category === 'goods' ? row.vat_deductible : true,
        description: null,
      }).select('id').single()
      if (e1) throw new Error(e1.message)

      // dòng hàng: dịch vụ không cần SKU; dùng amount_override + tax_override
      // để tổng khớp đúng hóa đơn gốc (tránh lệch làm tròn).
      const items = (row.items.length ? row.items : [{
        name: 'Dịch vụ', quantity: 1,
        unit_price: row.amount_before_tax, vat_rate: null,
        amount: row.amount_before_tax, tax: row.tax_amount,
      }]).map((it) => {
        const amount = it.amount ?? (Number(it.quantity || 1) * Number(it.unit_price || 0))
        return {
          invoice_id: inv.id,
          product_id: null,                       // dịch vụ: không gắn SKU
          description: it.name || null,
          quantity: Number(it.quantity ?? 1),
          unit_price: Number(it.unit_price ?? 0),
          vat_rate: [0, 5, 8, 10].includes(Number(it.vat_rate)) ? Number(it.vat_rate) : 8,
          amount_override: amount != null ? Number(amount) : null,
          tax_override: it.tax != null ? Number(it.tax) : null,
        }
      })
      const { error: e2 } = await supabase.from('invoice_items').insert(items)
      if (e2) throw new Error(e2.message)

      patchRow(idx, { status: 'done' })
    } catch (e) {
      patchRow(idx, { status: 'error', saveError: e.message })
    }
  }

  async function saveAll() {
    setSavingAll(true)
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].include && rows[i].status !== 'done') {
        // eslint-disable-next-line no-await-in-loop
        await saveRow(i)
      }
    }
    setSavingAll(false)
    onDone?.()   // để trang Hóa đơn load lại danh sách
  }

  const readyCount = rows.filter((r) => r.include && r.status !== 'done').length
  const doneCount = rows.filter((r) => r.status === 'done').length

  return (
    <Modal
      wide
      title="Import hóa đơn đầu vào (PDF / XML)"
      onClose={onClose}
      footer={
        <>
          <div style={{ marginRight: 'auto', color: 'var(--ink-soft)', fontSize: 13 }}>
            {rows.length > 0 &&
              <>Sẵn sàng ghi: <b>{readyCount}</b> · Đã ghi: <b className="pos">{doneCount}</b></>}
          </div>
          <button className="btn ghost" onClick={onClose}>Đóng</button>
          <button className="btn accent" onClick={saveAll}
            disabled={savingAll || readyCount === 0}>
            {savingAll ? 'Đang ghi sổ…' : `Ghi ${readyCount} hóa đơn vào sổ`}
          </button>
        </>
      }
    >
      <Alert>{err}</Alert>

      <div className="panel" style={{ boxShadow: 'none', background: '#f7f9fb', marginBottom: 14 }}>
        <div className="panel-body" style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="btn" style={{ cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Đang đọc…' : 'Chọn file PDF / XML'}
              <input ref={fileRef} type="file" accept=".pdf,.xml" multiple disabled={busy}
                style={{ display: 'none' }}
                onChange={(e) => {
                  // chuyển sang mảng NGAY, rồi mới reset input (reset làm mất e.target.files)
                  const picked = Array.from(e.target.files || [])
                  e.target.value = ''
                  onFiles(picked)
                }} />
            </label>
            <span className="inline-note" style={{ margin: 0 }}>
              Chọn nhiều file cùng lúc. XML đọc trực tiếp; PDF do AI đọc.
              Mặc định: hóa đơn dịch vụ, được khấu trừ — sửa lại từng dòng nếu cần.
            </span>
          </div>
          {progress && <div className="inline-note" style={{ marginTop: 8 }}>{progress}</div>}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">Chưa có file nào. Chọn file để bắt đầu.</div>
      ) : (
        <table className="grid" style={{ fontSize: 13.5 }}>
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Nhà cung cấp</th>
              <th style={{ width: 150 }}>MST</th>
              <th style={{ width: 110 }}>Ngày</th>
              <th style={{ width: 110 }}>Số HĐ</th>
              <th className="num" style={{ width: 140 }}>Chưa thuế</th>
              <th className="num" style={{ width: 130 }}>Thuế</th>
              <th className="num" style={{ width: 150 }}>Thành tiền</th>
              <th style={{ width: 150 }}>Hợp lệ</th>
              <th style={{ width: 90 }}>Ghi sổ</th>
              <th style={{ width: 28 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const matched = matchPartner(r.seller_tax_code)
              const total = Number(r.amount_before_tax || 0) + Number(r.tax_amount || 0)
              const valid = checkValid(r.buyer_tax_code)
              return (
                <tr key={i} style={r.parseError ? { background: 'var(--danger-soft)' } : undefined}>
                  <td>
                    <input type="checkbox" checked={r.include} disabled={!!r.parseError || r.status === 'done'}
                      onChange={(e) => patchRow(i, { include: e.target.checked })} />
                  </td>
                  <td>
                    <input value={r.seller_name}
                      onChange={(e) => patchRow(i, { seller_name: e.target.value })} />
                    <div className="inline-note" style={{ marginTop: 2 }}>
                      {r.source.toUpperCase()} · {r.fileName}
                      {r.seller_tax_code && (matched
                        ? <span className="pos"> · đã có NCC</span>
                        : <span className="muted"> · sẽ tạo NCC mới</span>)}
                    </div>
                    {r.parseError && <div className="neg" style={{ fontSize: 12 }}>{r.parseError}</div>}
                    {r.saveError && <div className="neg" style={{ fontSize: 12 }}>{r.saveError}</div>}
                  </td>
                  <td>
                    <input value={r.seller_tax_code}
                      onChange={(e) => patchRow(i, { seller_tax_code: e.target.value })} />
                  </td>
                  <td>
                    <input type="date" value={r.invoice_date}
                      onChange={(e) => patchRow(i, { invoice_date: e.target.value })} />
                  </td>
                  <td>
                    <input value={r.invoice_no}
                      onChange={(e) => patchRow(i, { invoice_no: e.target.value })} />
                  </td>
                  <td>
                    <input inputMode="numeric" value={money(r.amount_before_tax)}
                      style={{ textAlign: 'right' }}
                      onChange={(e) => patchRow(i, {
                        amount_before_tax: Number(String(e.target.value).replace(/[^\d]/g, '')) || 0
                      })} />
                  </td>
                  <td>
                    <input inputMode="numeric" value={money(r.tax_amount)}
                      style={{ textAlign: 'right' }}
                      onChange={(e) => patchRow(i, {
                        tax_amount: Number(String(e.target.value).replace(/[^\d]/g, '')) || 0
                      })} />
                  </td>
                  <td className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {money(total)}
                  </td>
                  <td>
                    {valid
                      ? <span className="badge in">✓ Hợp lệ</span>
                      : <span className="badge closed" title={
                          r.buyer_tax_code
                            ? `MST người mua: ${r.buyer_tax_code} (khác ${OWN_TAX_CODE})`
                            : 'Không đọc được MST người mua'
                        }>⚠ HĐ không hợp lệ</span>}
                  </td>
                  <td>
                    {r.status === 'ready' && <span className="muted">Chờ ghi</span>}
                    {r.status === 'saving' && <span className="muted">Đang ghi…</span>}
                    {r.status === 'done' && <span className="badge in">Đã ghi</span>}
                    {r.status === 'error' && <span className="badge closed">Lỗi</span>}
                  </td>
                  <td>
                    {r.status !== 'done' &&
                      <button className="icon-btn del" onClick={() => removeRow(i)}>✕</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {rows.some((r) => !r.parseError && !checkValid(r.buyer_tax_code)) && (
        <div className="alert warn" style={{ marginTop: 12 }}>
          Có hóa đơn <b>không hợp lệ</b> — MST người mua không khớp doanh nghiệp
          ({OWN_TAX_CODE}). Nên kiểm tra lại: có thể hóa đơn ghi sai, hoặc không phải
          hóa đơn mua vào của bạn. Những hóa đơn này vẫn ghi sổ được nếu bạn vẫn tick,
          nhưng hãy cân nhắc.
        </div>
      )}
    </Modal>
  )
}
