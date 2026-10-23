import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Empty, Loading, Modal } from '../components/ui'
import { vnd, dmy, recentYears } from '../lib/format'

const today = () => new Date().toISOString().slice(0, 10)

const blankHead = () => ({
  direction: 'in', invoice_no: '', invoice_date: today(),
  partner_id: '', category: 'goods', vat_deductible: true, description: '',
})
const blankLine = () => ({
  product_id: '', description: '', quantity: 1, unit_price: 0, vat_rate: 8,
})

export default function Invoices() {
  const [rows, setRows] = useState(null)
  const [partners, setPartners] = useState([])
  const [products, setProducts] = useState([])
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null)
  const [head, setHead] = useState(blankHead())
  const [lines, setLines] = useState([blankLine()])
  const [saving, setSaving] = useState(false)

  // filters
  const yNow = new Date().getFullYear()
  const [fDir, setFDir] = useState('')
  const [fYear, setFYear] = useState(yNow)
  const [fQuarter, setFQuarter] = useState('')

  async function load() {
    setErr('')
    let query = supabase.from('invoices')
      .select('*, partners(name)')
      .order('invoice_date', { ascending: false })
      .order('id', { ascending: false })
    if (fDir) query = query.eq('direction', fDir)
    // lọc theo năm/quý ở client cho đơn giản (dữ liệu nhỏ)
    const { data, error } = await query
    if (error) { setErr(error.message); return }
    let d = data
    d = d.filter((r) => new Date(r.invoice_date).getFullYear() === Number(fYear))
    if (fQuarter) {
      d = d.filter((r) => Math.floor(new Date(r.invoice_date).getMonth() / 3) + 1 === Number(fQuarter))
    }
    setRows(d)
  }

  async function loadRefs() {
    const [{ data: p }, { data: pr }] = await Promise.all([
      supabase.from('partners').select('id,name,is_supplier,is_customer').order('name'),
      supabase.from('products').select('id,sku,name,kind').order('sku'),
    ])
    setPartners(p || [])
    setProducts(pr || [])
  }

  useEffect(() => { loadRefs() }, [])
  useEffect(() => { load() }, [fDir, fYear, fQuarter])

  function openNew() {
    setHead(blankHead()); setLines([blankLine()]); setEditing('new')
  }

  async function openEdit(r) {
    const { data: items, error } = await supabase
      .from('invoice_items').select('*').eq('invoice_id', r.id).order('id')
    if (error) { setErr(error.message); return }
    setHead({
      direction: r.direction, invoice_no: r.invoice_no || '',
      invoice_date: r.invoice_date, partner_id: r.partner_id || '',
      category: r.category, vat_deductible: r.vat_deductible,
      description: r.description || '',
    })
    setLines(items.length ? items.map((i) => ({
      product_id: i.product_id || '', description: i.description || '',
      quantity: Number(i.quantity), unit_price: Number(i.unit_price),
      vat_rate: Number(i.vat_rate),
    })) : [blankLine()])
    setEditing(r)
  }

  function setLine(idx, patch) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }
  function addLine() { setLines((ls) => [...ls, blankLine()]) }
  function delLine(idx) { setLines((ls) => ls.filter((_, i) => i !== idx)) }

  const totals = useMemo(() => {
    let before = 0, tax = 0
    for (const l of lines) {
      const b = Number(l.quantity || 0) * Number(l.unit_price || 0)
      before += b
      tax += b * Number(l.vat_rate || 0) / 100
    }
    return { before, tax, total: before + tax }
  }, [lines])

  async function save() {
    setErr('')
    if (!head.invoice_date) { setErr('Chọn ngày hóa đơn.'); return }
    const cleanLines = lines.filter((l) => Number(l.quantity) > 0 || Number(l.unit_price) > 0)
    if (cleanLines.length === 0) { setErr('Hóa đơn phải có ít nhất một dòng.'); return }
    // hàng hóa cần SKU để vào tồn kho
    for (const l of cleanLines) {
      if (head.category === 'goods' && !l.product_id) {
        setErr('Hóa đơn hàng hóa: mỗi dòng phải chọn sản phẩm (SKU) để vào tồn kho.')
        return
      }
    }
    setSaving(true)
    const headPayload = {
      direction: head.direction,
      invoice_no: head.invoice_no.trim() || null,
      invoice_date: head.invoice_date,
      partner_id: head.partner_id || null,
      category: head.category,
      // vat_deductible chỉ có ý nghĩa với hóa đơn mua; bán ra luôn để true
      vat_deductible: head.direction === 'in' ? head.vat_deductible : true,
      description: head.description.trim() || null,
    }

    let invoiceId
    if (editing === 'new') {
      const { data, error } = await supabase.from('invoices').insert(headPayload).select('id').single()
      if (error) { setErr(error.message); setSaving(false); return }
      invoiceId = data.id
    } else {
      invoiceId = editing.id
      const { error } = await supabase.from('invoices').update(headPayload).eq('id', invoiceId)
      if (error) { setErr(error.message); setSaving(false); return }
      await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId)
    }

    const itemsPayload = cleanLines.map((l) => ({
      invoice_id: invoiceId,
      product_id: l.product_id || null,
      description: l.description.trim() || null,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      vat_rate: Number(l.vat_rate),
    }))
    const { error: e2 } = await supabase.from('invoice_items').insert(itemsPayload)
    setSaving(false)
    if (e2) { setErr(e2.message); return }
    setEditing(null); load()
  }

  async function remove(r) {
    if (!confirm(`Xóa hóa đơn ${r.invoice_no || '(không số)'} ngày ${dmy(r.invoice_date)}?`)) return
    const { error } = await supabase.from('invoices').delete().eq('id', r.id)
    if (error) setErr(error.message)
    else load()
  }

  const partnerOptions = partners.filter((p) =>
    head.direction === 'in' ? p.is_supplier : p.is_customer
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hóa đơn</h1>
          <div className="sub">Nhập hóa đơn mua vào và bán ra. Thuế và tổng tiền tự tính.</div>
        </div>
        <button className="btn" onClick={openNew}>+ Nhập hóa đơn</button>
      </div>

      <Alert>{err}</Alert>

      <div className="toolbar">
        <div className="field">
          <label>Chiều</label>
          <select value={fDir} onChange={(e) => setFDir(e.target.value)}>
            <option value="">Tất cả</option>
            <option value="in">Mua vào</option>
            <option value="out">Bán ra</option>
          </select>
        </div>
        <div className="field">
          <label>Năm</label>
          <select value={fYear} onChange={(e) => setFYear(e.target.value)}>
            {recentYears().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Quý</label>
          <select value={fQuarter} onChange={(e) => setFQuarter(e.target.value)}>
            <option value="">Cả năm</option>
            <option value="1">Q1</option><option value="2">Q2</option>
            <option value="3">Q3</option><option value="4">Q4</option>
          </select>
        </div>
      </div>

      <Panel>
        {rows === null ? <Loading /> : rows.length === 0 ? (
          <Empty>Không có hóa đơn nào trong kỳ đã chọn.</Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Ngày</th><th>Số HĐ</th><th>Chiều</th><th>Đối tác</th>
                <th>Loại</th><th>Khấu trừ</th>
                <th className="num">Chưa thuế</th><th className="num">Thuế</th>
                <th className="num">Tổng</th><th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{dmy(r.invoice_date)}</td>
                  <td>{r.invoice_no || <span className="muted">—</span>}</td>
                  <td>
                    <span className={`badge ${r.direction}`}>
                      {r.direction === 'in' ? 'Mua' : 'Bán'}
                    </span>
                  </td>
                  <td>{r.partners?.name || <span className="muted">—</span>}</td>
                  <td>
                    <span className={`badge ${r.category}`}>
                      {r.category === 'goods' ? 'Hàng hóa' : 'Dịch vụ'}
                    </span>
                  </td>
                  <td>
                    {r.direction === 'in'
                      ? (r.vat_deductible
                        ? <span className="muted">Được</span>
                        : <span className="neg">Không</span>)
                      : <span className="muted">—</span>}
                  </td>
                  <td className="num">{vnd(r.amount_before_tax)}</td>
                  <td className="num">{vnd(r.tax_amount)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{vnd(r.amount_total)}</td>
                  <td>
                    <button className="icon-btn" onClick={() => openEdit(r)}>Sửa</button>
                    <button className="icon-btn del" onClick={() => remove(r)}>Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {editing && (
        <Modal
          title={editing === 'new' ? 'Nhập hóa đơn' : 'Sửa hóa đơn'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <div style={{ marginRight: 'auto', color: 'var(--ink-soft)', fontSize: 13 }}>
                Chưa thuế: <b>{vnd(totals.before)}</b> &nbsp;·&nbsp;
                Thuế: <b>{vnd(totals.tax)}</b> &nbsp;·&nbsp;
                Tổng: <b style={{ color: 'var(--brand-ink)' }}>{vnd(totals.total)}</b>
              </div>
              <button className="btn ghost" onClick={() => setEditing(null)}>Hủy</button>
              <button className="btn accent" onClick={save} disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu hóa đơn'}
              </button>
            </>
          }
        >
          <div className="row c4">
            <div className="field">
              <label>Chiều *</label>
              <select value={head.direction}
                onChange={(e) => setHead({ ...head, direction: e.target.value, partner_id: '' })}>
                <option value="in">Mua vào</option>
                <option value="out">Bán ra</option>
              </select>
            </div>
            <div className="field">
              <label>Ngày hóa đơn *</label>
              <input type="date" value={head.invoice_date}
                onChange={(e) => setHead({ ...head, invoice_date: e.target.value })} />
            </div>
            <div className="field">
              <label>Số hóa đơn</label>
              <input value={head.invoice_no}
                onChange={(e) => setHead({ ...head, invoice_no: e.target.value })} />
            </div>
            <div className="field">
              <label>Loại *</label>
              <select value={head.category}
                onChange={(e) => setHead({ ...head, category: e.target.value })}>
                <option value="goods">Hàng hóa</option>
                <option value="service">Dịch vụ</option>
              </select>
            </div>
          </div>

          <div className="row c2">
            <div className="field">
              <label>{head.direction === 'in' ? 'Nhà cung cấp' : 'Khách hàng'}</label>
              <select value={head.partner_id}
                onChange={(e) => setHead({ ...head, partner_id: e.target.value })}>
                <option value="">— Chọn —</option>
                {partnerOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {head.direction === 'in' && (
              <div className="field">
                <label>Thuế GTGT đầu vào</label>
                <select value={head.vat_deductible ? '1' : '0'}
                  onChange={(e) => setHead({ ...head, vat_deductible: e.target.value === '1' })}>
                  <option value="1">Đủ điều kiện khấu trừ</option>
                  <option value="0">Không được khấu trừ (tính vào chi phí)</option>
                </select>
              </div>
            )}
          </div>

          <div className="field">
            <label>Diễn giải</label>
            <input value={head.description}
              onChange={(e) => setHead({ ...head, description: e.target.value })} />
          </div>

          <table className="grid" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Sản phẩm {head.category === 'goods' && '*'}</th>
                <th>Diễn giải</th>
                <th className="num" style={{ width: 80 }}>SL</th>
                <th className="num" style={{ width: 120 }}>Đơn giá</th>
                <th className="num" style={{ width: 80 }}>%VAT</th>
                <th className="num" style={{ width: 120 }}>Thành tiền</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const b = Number(l.quantity || 0) * Number(l.unit_price || 0)
                return (
                  <tr key={i}>
                    <td>
                      <select value={l.product_id}
                        onChange={(e) => setLine(i, { product_id: e.target.value })}>
                        <option value="">— Chọn —</option>
                        {products
                          .filter((p) => head.category === 'goods' ? p.kind === 'goods' : true)
                          .map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <input value={l.description}
                        onChange={(e) => setLine(i, { description: e.target.value })} />
                    </td>
                    <td>
                      <input type="number" min="0" step="any" value={l.quantity}
                        style={{ textAlign: 'right' }}
                        onChange={(e) => setLine(i, { quantity: e.target.value })} />
                    </td>
                    <td>
                      <input type="number" min="0" step="any" value={l.unit_price}
                        style={{ textAlign: 'right' }}
                        onChange={(e) => setLine(i, { unit_price: e.target.value })} />
                    </td>
                    <td>
                      <select value={l.vat_rate}
                        onChange={(e) => setLine(i, { vat_rate: e.target.value })}>
                        <option value="0">0</option><option value="5">5</option>
                        <option value="8">8</option><option value="10">10</option>
                      </select>
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{vnd(b)}</td>
                    <td>
                      {lines.length > 1 &&
                        <button className="icon-btn del" onClick={() => delLine(i)}>✕</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={addLine}>
            + Thêm dòng
          </button>

          {head.direction === 'in' && !head.vat_deductible && (
            <div className="alert warn" style={{ marginTop: 12 }}>
              Hóa đơn này không được khấu trừ VAT — toàn bộ tiền thuế sẽ được tính vào
              chi phí, không trừ vào số VAT phải nộp.
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
