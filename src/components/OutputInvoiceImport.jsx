import { useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal, Alert, Empty } from './ui'
import { vnd, dmy } from '../lib/format'
import { parseOutputInvoices } from '../lib/outputInvoiceImport'

// Chuẩn hóa MST để so khớp
const normMst = (s) => String(s || '').replace(/\s/g, '')

export default function OutputInvoiceImport({ partners, products, onClose, onDone }) {
  const [invoices, setInvoices] = useState([])   // đã gom dòng
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)      // {written, skipped, failed}
  const [range, setRange] = useState({ from: '', to: '' })
  const fileRef = useRef()

  // map sku -> product (khớp theo mã hàng, bỏ hoa/thường + khoảng trắng)
  const skuMap = useMemo(() => {
    const m = new Map()
    for (const p of products || []) m.set(String(p.sku).trim().toLowerCase(), p)
    return m
  }, [products])

  async function onFile(file) {
    setErr(''); setResult(null); setInvoices([])
    if (!file) return
    setBusy(true); setProgress('Đang đọc file…')
    try {
      const invs = await parseOutputInvoices(file)
      if (invs.length === 0) { setErr('Không đọc được hóa đơn nào.'); setBusy(false); return }
      setInvoices(invs)
      // đặt khoảng ngày mặc định = toàn bộ file
      const dates = invs.map((i) => i.invoice_date).filter(Boolean).sort()
      setRange({ from: dates[0] || '', to: dates[dates.length - 1] || '' })
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false); setProgress('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // lọc theo khoảng ngày để tổng hợp
  const inRange = useMemo(() => {
    return invoices.filter((inv) =>
      (!range.from || inv.invoice_date >= range.from) &&
      (!range.to || inv.invoice_date <= range.to))
  }, [invoices, range])

  const totals = useMemo(() => {
    let amount = 0, tax = 0, total = 0
    for (const inv of inRange) { amount += inv.sum_amount; tax += inv.sum_tax; total += inv.sum_total }
    return { amount, tax, total, count: inRange.length }
  }, [inRange])

  // thống kê khớp SKU
  const skuStats = useMemo(() => {
    let matched = 0, unmatched = 0
    const unmatchedSkus = new Set()
    for (const inv of invoices) {
      for (const it of inv.items) {
        if (!it.sku) continue
        if (skuMap.has(it.sku.toLowerCase())) matched++
        else { unmatched++; unmatchedSkus.add(it.sku) }
      }
    }
    return { matched, unmatched, unmatchedSkus: Array.from(unmatchedSkus) }
  }, [invoices, skuMap])

  // Tìm hoặc tạo đối tác khách hàng. Khách lẻ (không MST) gộp vào 1 "Khách lẻ".
  async function resolveCustomer(inv, cacheRetail, cacheByMst) {
    if (inv.has_mst) {
      const key = normMst(inv.mst)
      if (cacheByMst.has(key)) return cacheByMst.get(key)
      // tìm trong danh mục
      const found = (partners || []).find((p) => normMst(p.tax_code) === key)
      if (found) { cacheByMst.set(key, found.id); return found.id }
      // tạo mới
      const { data, error } = await supabase.from('partners').insert({
        name: inv.cust_name || '(khách có MST)', tax_code: inv.mst,
        is_customer: true, is_supplier: false,
      }).select('id').single()
      if (error) throw new Error('Tạo KH lỗi: ' + error.message)
      cacheByMst.set(key, data.id)
      return data.id
    }
    // khách lẻ
    if (cacheRetail.id) return cacheRetail.id
    const existing = (partners || []).find((p) => p.name === 'Khách lẻ' && p.is_customer)
    if (existing) { cacheRetail.id = existing.id; return existing.id }
    const { data, error } = await supabase.from('partners').insert({
      name: 'Khách lẻ', is_customer: true, is_supplier: false,
    }).select('id').single()
    if (error) throw new Error('Tạo Khách lẻ lỗi: ' + error.message)
    cacheRetail.id = data.id
    return data.id
  }

  async function saveAll() {
    if (saving) return   // chống bấm 2 lần
    setErr(''); setSaving(true); setResult(null)
    const cacheRetail = {}, cacheByMst = new Map()
    let written = 0, skipped = 0, failed = 0
    try {
      // B1: hỏi DB những hóa đơn bán ra ĐÃ CÓ để BỎ QUA. Khóa nhận dạng là
      // (số HĐ + ngày + ký hiệu) — vì số HĐ không duy nhất giữa các ký hiệu.
      setProgress('Đang kiểm tra hóa đơn đã có…')
      const existing = new Set()
      const idKey = (no, date, sym) => `${no}|${date}|${sym || ''}`
      const allNos = [...new Set(invoices.map((v) => v.invoice_no))]
      for (let s = 0; s < allNos.length; s += 500) {
        const chunk = allNos.slice(s, s + 500)
        // eslint-disable-next-line no-await-in-loop
        const { data } = await supabase.from('invoices')
          .select('invoice_no, invoice_date, symbol').eq('direction', 'out').in('invoice_no', chunk)
        for (const r of data || []) existing.add(idKey(r.invoice_no, r.invoice_date, r.symbol))
      }
      const todo = invoices.filter((v) => !existing.has(idKey(v.invoice_no, v.invoice_date, v.symbol)))
      skipped = invoices.length - todo.length
      if (todo.length === 0) {
        setResult({ written: 0, skipped, failed: 0 })
        setProgress(''); setSaving(false); onDone?.()
        return
      }

      for (let i = 0; i < todo.length; i++) {
        const inv = todo[i]
        if (i % 20 === 0) setProgress(`Đang ghi ${i + 1}/${todo.length}…`)
        // eslint-disable-next-line no-await-in-loop
        const partnerId = await resolveCustomer(inv, cacheRetail, cacheByMst)

        // ghi đầu hóa đơn (bán ra)
        // eslint-disable-next-line no-await-in-loop
        const { data: head, error: e1 } = await supabase.from('invoices').insert({
          direction: 'out',
          symbol: inv.symbol || null,
          invoice_no: inv.invoice_no,
          invoice_date: inv.invoice_date,
          partner_id: partnerId,
          category: 'goods',
          vat_deductible: true,
          description: inv.symbol ? `Ký hiệu ${inv.symbol}` : null,
        }).select('id').single()
        if (e1) {
          if (e1.code === '23505') { skipped++; continue }  // đã có -> bỏ qua
          failed++; continue
        }

        // ghi dòng hàng: khớp SKU theo mã hàng; dùng amount/tax override để khớp đúng file
        const items = inv.items.map((it) => {
          const prod = it.sku ? skuMap.get(it.sku.toLowerCase()) : null
          return {
            invoice_id: head.id,
            product_id: prod ? prod.id : null,   // khớp -> trừ kho; không khớp -> null
            description: it.name || null,
            quantity: it.qty || 1,
            unit_price: it.price || 0,
            vat_rate: [0, 5, 8, 10].includes(Number(it.vat_rate)) ? Number(it.vat_rate) : 8,
            amount_override: it.amount,   // tiền hàng = TT - thuế (đúng file)
            tax_override: it.tax,
          }
        })
        // eslint-disable-next-line no-await-in-loop
        const { error: e2 } = await supabase.from('invoice_items').insert(items)
        if (e2) { failed++; continue }
        written++
      }
      setResult({ written, skipped, failed })
      setProgress('')
      onDone?.()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      wide
      title="Import hóa đơn đầu ra (Excel từ phần mềm HĐĐT)"
      onClose={onClose}
      footer={<>
        <div style={{ marginRight: 'auto', color: 'var(--ink-soft)', fontSize: 13 }}>
          {progress || (invoices.length > 0 && `${invoices.length} hóa đơn đã đọc`)}
        </div>
        <button className="btn ghost" onClick={onClose}>Đóng</button>
        <button className="btn accent" onClick={saveAll}
          disabled={saving || invoices.length === 0}>
          {saving ? 'Đang ghi sổ…' : `Ghi ${invoices.length} hóa đơn vào sổ`}
        </button>
      </>}
    >
      {err && <Alert>{err}</Alert>}
      {result && (
        <Alert kind="ok">
          Đã ghi <b>{result.written}</b> hóa đơn
          {result.skipped > 0 && <> · bỏ qua <b>{result.skipped}</b> (đã tồn tại)</>}
          {result.failed > 0 && <> · lỗi <b>{result.failed}</b></>}.
        </Alert>
      )}

      <div className="panel" style={{ boxShadow: 'none', background: '#f7f9fb', marginBottom: 14 }}>
        <div className="panel-body" style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="btn" style={{ cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Đang đọc…' : 'Chọn file Excel'}
              <input ref={fileRef} type="file" accept=".xlsx,.xls" disabled={busy}
                style={{ display: 'none' }}
                onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            <span className="inline-note" style={{ margin: 0 }}>
              File bảng kê chi tiết HĐ đã sử dụng. Đọc trực tiếp (không dùng AI).
              Mỗi hóa đơn ghi vào sổ như hóa đơn bán ra; khớp SKU theo mã hàng.
            </span>
          </div>
        </div>
      </div>

      {invoices.length === 0 ? (
        <Empty>Chưa có file. Chọn file để bắt đầu.</Empty>
      ) : (
        <>
          {/* Tổng hợp theo khoảng ngày */}
          <div className="panel" style={{ boxShadow: 'none', marginBottom: 14 }}>
            <div className="panel-head">Tổng hợp theo khoảng ngày</div>
            <div className="panel-body">
              <div className="toolbar" style={{ marginBottom: 12 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Từ ngày</label>
                  <input type="date" value={range.from}
                    onChange={(e) => setRange({ ...range, from: e.target.value })} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Đến ngày</label>
                  <input type="date" value={range.to}
                    onChange={(e) => setRange({ ...range, to: e.target.value })} />
                </div>
              </div>
              <div className="kpis" style={{ marginBottom: 0 }}>
                <div className="kpi"><div className="label">Số hóa đơn</div>
                  <div className="value">{totals.count}</div></div>
                <div className="kpi"><div className="label">Tiền hàng (chưa thuế)</div>
                  <div className="value">{vnd(totals.amount)}</div></div>
                <div className="kpi"><div className="label">Tiền thuế GTGT</div>
                  <div className="value">{vnd(totals.tax)}</div></div>
                <div className="kpi"><div className="label">Tổng tiền TT</div>
                  <div className="value">{vnd(totals.total)}</div></div>
              </div>
            </div>
          </div>

          {/* Khớp SKU */}
          <div className={`alert ${skuStats.unmatched > 0 ? 'warn' : 'ok'}`}>
            Khớp SKU theo mã hàng: <b>{skuStats.matched}</b> dòng khớp
            {skuStats.unmatched > 0 && <>, <b>{skuStats.unmatched}</b> dòng KHÔNG khớp</>}.
            {skuStats.unmatched > 0 && <> Dòng không khớp vẫn ghi doanh thu + thuế nhưng
              không trừ kho (giá vốn = 0). Mã chưa có: {skuStats.unmatchedSkus.slice(0, 8).join(', ')}
              {skuStats.unmatchedSkus.length > 8 && '…'}</>}
          </div>

          {/* Xem trước vài hóa đơn */}
          <div className="panel" style={{ boxShadow: 'none' }}>
            <div className="panel-head">Xem trước (20 hóa đơn đầu)</div>
            <div className="panel-body">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 92 }}>Ngày</th>
                    <th style={{ width: 100 }}>Số HĐ</th>
                    <th>Khách hàng</th>
                    <th style={{ width: 110 }}>MST</th>
                    <th className="num" style={{ width: 60 }}>Dòng</th>
                    <th className="num" style={{ width: 140 }}>Tiền hàng</th>
                    <th className="num" style={{ width: 130 }}>Thuế</th>
                    <th className="num" style={{ width: 140 }}>Tổng TT</th>
                  </tr>
                </thead>
                <tbody>
                  {inRange.slice(0, 20).map((inv) => (
                    <tr key={inv.key}>
                      <td>{dmy(inv.invoice_date)}</td>
                      <td>{inv.invoice_no}</td>
                      <td>{inv.cust_name || <span className="muted">—</span>}</td>
                      <td>{inv.has_mst ? inv.mst : <span className="muted">khách lẻ</span>}</td>
                      <td className="num">{inv.items.length}</td>
                      <td className="num">{vnd(inv.sum_amount)}</td>
                      <td className="num">{vnd(inv.sum_tax)}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{vnd(inv.sum_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inRange.length > 20 &&
                <div className="inline-note" style={{ marginTop: 8 }}>
                  … và {inRange.length - 20} hóa đơn khác. Bấm “Ghi vào sổ” để ghi tất cả.
                </div>}
            </div>
          </div>

          <div className="alert warn" style={{ marginTop: 12 }}>
            Ghi {invoices.length} hóa đơn có thể mất một chút thời gian. Hóa đơn đã tồn tại
            (trùng số + khách) sẽ tự bỏ qua. Doanh thu và VAT đầu ra sẽ tự cập nhật ở Báo cáo.
          </div>
        </>
      )}
    </Modal>
  )
}
