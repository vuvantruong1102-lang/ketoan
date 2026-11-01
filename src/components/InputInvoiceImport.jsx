import { useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal, Alert, Empty } from './ui'
import { vnd, dmy } from '../lib/format'
import { parseInputInvoices } from '../lib/inputInvoiceImport'

const normMst = (s) => String(s || '').replace(/\s/g, '')

export default function InputInvoiceImport({ partners, onClose, onDone }) {
  const [invoices, setInvoices] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [range, setRange] = useState({ from: '', to: '' })
  const fileRef = useRef()

  async function onFile(file) {
    setErr(''); setResult(null); setInvoices([])
    if (!file) return
    setBusy(true); setProgress('Đang đọc file…')
    try {
      const invs = await parseInputInvoices(file)
      if (invs.length === 0) { setErr('Không đọc được hóa đơn nào.'); setBusy(false); return }
      setInvoices(invs)
      const dates = invs.map((i) => i.invoice_date).filter(Boolean).sort()
      setRange({ from: dates[0] || '', to: dates[dates.length - 1] || '' })
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false); setProgress('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const inRange = useMemo(() => invoices.filter((inv) =>
    (!range.from || inv.invoice_date >= range.from) &&
    (!range.to || inv.invoice_date <= range.to)), [invoices, range])

  const totals = useMemo(() => {
    let amount = 0, tax = 0, total = 0
    for (const inv of inRange) { amount += inv.amount; tax += inv.tax; total += inv.total }
    return { amount, tax, total, count: inRange.length }
  }, [inRange])

  function matchPartner(mst) {
    const t = normMst(mst)
    if (!t) return null
    const f = (partners || []).find((p) => normMst(p.tax_code) === t)
    return f ? f.id : null
  }

  async function ensureSupplier(inv, cache) {
    const key = normMst(inv.mst) || ('name:' + inv.seller_name)
    if (cache.has(key)) return cache.get(key)
    const existing = inv.mst ? matchPartner(inv.mst) : null
    if (existing) { cache.set(key, existing); return existing }
    const { data, error } = await supabase.from('partners').insert({
      name: inv.seller_name || '(NCC chưa rõ tên)',
      tax_code: inv.mst || null,
      is_supplier: true, is_customer: false,
    }).select('id').single()
    if (error) throw new Error('Tạo NCC lỗi: ' + error.message)
    cache.set(key, data.id)
    return data.id
  }

  async function saveAll() {
    if (saving) return
    setErr(''); setSaving(true); setResult(null)
    const cache = new Map()
    let written = 0, skipped = 0, failed = 0
    try {
      // bỏ qua hóa đơn đã có (trùng số + chiều in)
      setProgress('Đang kiểm tra hóa đơn đã có…')
      const existing = new Set()
      const idKey = (no, date) => `${no}|${date}`
      const nos = [...new Set(invoices.map((v) => v.invoice_no))]
      for (let s = 0; s < nos.length; s += 500) {
        // eslint-disable-next-line no-await-in-loop
        const { data } = await supabase.from('invoices')
          .select('invoice_no, invoice_date').eq('direction', 'in').in('invoice_no', nos.slice(s, s + 500))
        for (const r of data || []) existing.add(idKey(r.invoice_no, r.invoice_date))
      }
      const todo = invoices.filter((v) => !existing.has(idKey(v.invoice_no, v.invoice_date)))
      skipped = invoices.length - todo.length
      if (todo.length === 0) {
        setResult({ written: 0, skipped, failed: 0 }); setProgress(''); setSaving(false); onDone?.(); return
      }

      for (let i = 0; i < todo.length; i++) {
        const inv = todo[i]
        if (i % 20 === 0) setProgress(`Đang ghi ${i + 1}/${todo.length}…`)
        // eslint-disable-next-line no-await-in-loop
        const partnerId = await ensureSupplier(inv, cache)
        // đầu hóa đơn: mua vào, dịch vụ, được khấu trừ
        // eslint-disable-next-line no-await-in-loop
        const { data: head, error: e1 } = await supabase.from('invoices').insert({
          direction: 'in', invoice_no: inv.invoice_no, invoice_date: inv.invoice_date,
          partner_id: partnerId, category: 'service', vat_deductible: true, description: null,
        }).select('id').single()
        if (e1) { if (e1.code === '23505') { skipped++; continue } failed++; continue }
        // một dòng hàng: tiền hàng + thuế (dùng override để khớp đúng file)
        // eslint-disable-next-line no-await-in-loop
        const { error: e2 } = await supabase.from('invoice_items').insert({
          invoice_id: head.id, product_id: null, description: inv.seller_name || 'Dịch vụ',
          quantity: 1, unit_price: inv.amount, vat_rate: 8,
          amount_override: inv.amount, tax_override: inv.tax,
        })
        if (e2) { failed++; continue }
        written++
      }
      setResult({ written, skipped, failed }); setProgress(''); onDone?.()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      wide
      title="Import bảng kê hóa đơn đầu vào (Excel)"
      onClose={onClose}
      footer={<>
        <div style={{ marginRight: 'auto', color: 'var(--ink-soft)', fontSize: 13 }}>
          {progress || (invoices.length > 0 && `${invoices.length} hóa đơn đã đọc`)}
        </div>
        <button className="btn ghost" onClick={onClose}>Đóng</button>
        <button className="btn accent" onClick={saveAll} disabled={saving || invoices.length === 0}>
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
                style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            <span className="inline-note" style={{ margin: 0 }}>
              Bảng kê hóa đơn đầu vào. Mặc định: hóa đơn <b>dịch vụ</b>, <b>được khấu trừ</b> VAT.
            </span>
          </div>
        </div>
      </div>

      {invoices.length === 0 ? (
        <Empty>Chưa có file. Chọn file để bắt đầu.</Empty>
      ) : (
        <>
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
                <div className="kpi"><div className="label">Số hóa đơn</div><div className="value">{totals.count}</div></div>
                <div className="kpi"><div className="label">Tiền hàng (chưa thuế)</div><div className="value">{vnd(totals.amount)}</div></div>
                <div className="kpi"><div className="label">Thuế GTGT đầu vào</div><div className="value">{vnd(totals.tax)}</div></div>
                <div className="kpi"><div className="label">Tổng tiền TT</div><div className="value">{vnd(totals.total)}</div></div>
              </div>
            </div>
          </div>

          <div className="panel" style={{ boxShadow: 'none' }}>
            <div className="panel-head">Xem trước (20 hóa đơn đầu)</div>
            <div className="panel-body">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 92 }}>Ngày</th><th style={{ width: 100 }}>Số HĐ</th>
                    <th>Nhà cung cấp</th><th style={{ width: 120 }}>MST</th>
                    <th className="num" style={{ width: 140 }}>Tiền hàng</th>
                    <th className="num" style={{ width: 130 }}>Thuế</th>
                    <th className="num" style={{ width: 140 }}>Tổng TT</th>
                  </tr>
                </thead>
                <tbody>
                  {inRange.slice(0, 20).map((inv, i) => {
                    const matched = matchPartner(inv.mst)
                    return (
                      <tr key={i}>
                        <td>{dmy(inv.invoice_date)}</td>
                        <td>{inv.invoice_no}</td>
                        <td>{inv.seller_name || <span className="muted">—</span>}
                          <div className="inline-note" style={{ marginTop: 2 }}>
                            {inv.mst && (matched
                              ? <span className="pos">đã có NCC</span>
                              : <span className="muted">sẽ tạo NCC mới</span>)}
                          </div>
                        </td>
                        <td>{inv.mst || <span className="muted">—</span>}</td>
                        <td className="num">{vnd(inv.amount)}</td>
                        <td className="num">{vnd(inv.tax)}</td>
                        <td className="num" style={{ fontWeight: 600 }}>{vnd(inv.total)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {inRange.length > 20 &&
                <div className="inline-note" style={{ marginTop: 8 }}>
                  … và {inRange.length - 20} hóa đơn khác. Bấm “Ghi vào sổ” để ghi tất cả.
                </div>}
            </div>
          </div>

          <div className="alert warn" style={{ marginTop: 12 }}>
            Hóa đơn đã tồn tại (trùng số) sẽ tự bỏ qua. Thuế đầu vào được khấu trừ sẽ tự cập nhật ở Báo cáo VAT.
          </div>
        </>
      )}
    </Modal>
  )
}
