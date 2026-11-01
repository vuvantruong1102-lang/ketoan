import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Empty, Loading, Modal } from '../components/ui'
import InvoiceImport from '../components/InvoiceImport'
// Tải lười: kéo theo xlsx (nặng), chỉ nạp khi mở modal import đầu ra.
const OutputInvoiceImport = lazy(() => import('../components/OutputInvoiceImport'))
const InputInvoiceImport = lazy(() => import('../components/InputInvoiceImport'))
import { exportVatPurchaseListing, exportVatSaleListing } from '../lib/exportVatListing'
import { vnd, dmy, recentYears } from '../lib/format'

const today = () => new Date().toISOString().slice(0, 10)

const blankHead = (dir = 'in') => ({
  direction: dir, invoice_no: '', invoice_date: today(),
  partner_id: '', category: 'goods', vat_deductible: true, description: '',
})
const blankLine = () => ({
  product_id: '', description: '', quantity: 1, unit_price: 0, vat_rate: 8,
  // để trống = tự tính; nhập số = ghi đè để khớp hóa đơn NCC
  amount_override: '', tax_override: '',
})

export default function Invoices({ direction = 'in' }) {
  const isOut = direction === 'out'
  const [rows, setRows] = useState(null)
  const [partners, setPartners] = useState([])
  const [products, setProducts] = useState([])
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null)
  const [head, setHead] = useState(blankHead(direction))
  const [lines, setLines] = useState([blankLine()])
  const [saving, setSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showOutImport, setShowOutImport] = useState(false)
  const [showInImport, setShowInImport] = useState(false)
  // số dòng hiển thị (bấm "hiện thêm" để tăng)
  const PAGE = 20
  const [vis, setVis] = useState(PAGE)

  // filters
  const yNow = new Date().getFullYear()
  const [fYear, setFYear] = useState(yNow)
  const [fQuarter, setFQuarter] = useState('')

  async function load() {
    setErr('')
    // Lọc theo khoảng ngày NGAY TRONG TRUY VẤN (không lọc ở client), nếu không
    // Supabase chỉ trả 1000 dòng mới nhất và sẽ thiếu hóa đơn cũ của kỳ.
    const y = Number(fYear)
    let from, to
    if (fQuarter) {
      const q = Number(fQuarter)
      const m0 = (q - 1) * 3            // tháng bắt đầu (0-based)
      from = `${y}-${String(m0 + 1).padStart(2, '0')}-01`
      // ngày đầu quý sau
      const nextM = m0 + 3
      to = nextM >= 12 ? `${y + 1}-01-01` : `${y}-${String(nextM + 1).padStart(2, '0')}-01`
    } else {
      from = `${y}-01-01`
      to = `${y + 1}-01-01`
    }

    // Supabase chặn tối đa 1000 dòng/truy vấn (cấu hình server), nên phải tải
    // theo LÔ 1000 rồi ghép lại cho đủ cả kỳ (có thể vài nghìn hóa đơn).
    const BATCH = 1000
    let all = []
    for (let offset = 0; ; offset += BATCH) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase.from('invoices')
        .select('*, partners(name, tax_code)')
        .eq('direction', direction)
        .gte('invoice_date', from)
        .lt('invoice_date', to)
        .order('invoice_date', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + BATCH - 1)
      if (error) { setErr(error.message); return }
      all = all.concat(data || [])
      if (!data || data.length < BATCH) break   // hết dữ liệu
    }
    setRows(all)
  }

  async function loadRefs() {
    const [{ data: p }, { data: pr }] = await Promise.all([
      supabase.from('partners').select('id,name,tax_code,is_supplier,is_customer').order('name'),
      supabase.from('products').select('id,sku,name,kind').order('sku'),
    ])
    setPartners(p || [])
    setProducts(pr || [])
  }

  useEffect(() => { loadRefs() }, [])
  useEffect(() => { load(); setVis(PAGE) }, [fYear, fQuarter, direction])

  function openNew() {
    setHead(blankHead(direction)); setLines([blankLine()]); setEditing('new')
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
      amount_override: i.amount_override == null ? '' : String(i.amount_override),
      tax_override: i.tax_override == null ? '' : String(i.tax_override),
    })) : [blankLine()])
    setEditing(r)
  }

  function setLine(idx, patch) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }
  function addLine() { setLines((ls) => [...ls, blankLine()]) }
  function delLine(idx) { setLines((ls) => ls.filter((_, i) => i !== idx)) }

  // Tính tổng GIỐNG HỆT trigger ở database: làm tròn từng dòng, ưu tiên số ghi đè.
  function lineAmounts(l) {
    const before = l.amount_override !== '' && l.amount_override != null
      ? Number(l.amount_override)
      : Math.round(Number(l.quantity || 0) * Number(l.unit_price || 0))
    const tax = l.tax_override !== '' && l.tax_override != null
      ? Number(l.tax_override)
      : Math.round(before * Number(l.vat_rate || 0) / 100)
    return { before, tax, total: before + tax }
  }

  const totals = useMemo(() => {
    let before = 0, tax = 0
    for (const l of lines) {
      const a = lineAmounts(l)
      before += a.before
      tax += a.tax
    }
    return { before, tax, total: before + tax }
  }, [lines])

  async function save() {
    setErr('')
    if (!head.invoice_date) { setErr('Chọn ngày hóa đơn.'); return }
    if (!head.partner_id) {
      setErr(head.direction === 'in' ? 'Phải chọn nhà cung cấp.' : 'Phải chọn khách hàng.')
      return
    }
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
      if (error) {
        setErr(error.code === '23505'
          ? `Số hóa đơn "${head.invoice_no}" đã tồn tại cho đối tác này. Không thể lưu trùng.`
          : error.message)
        setSaving(false); return
      }
      invoiceId = data.id
    } else {
      invoiceId = editing.id
      const { error } = await supabase.from('invoices').update(headPayload).eq('id', invoiceId)
      if (error) {
        setErr(error.code === '23505'
          ? `Số hóa đơn "${head.invoice_no}" đã tồn tại cho đối tác này. Không thể lưu trùng.`
          : error.message)
        setSaving(false); return
      }
      await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId)
    }

    const itemsPayload = cleanLines.map((l) => ({
      invoice_id: invoiceId,
      product_id: l.product_id || null,
      description: l.description.trim() || null,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      vat_rate: Number(l.vat_rate),
      amount_override: l.amount_override === '' ? null : Number(l.amount_override),
      tax_override: l.tax_override === '' ? null : Number(l.tax_override),
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

  // Render panel hóa đơn với phân trang "hiện thêm".
  function renderInvoicePanel({ title, dir }) {
    const list = (rows || []).filter((r) => r.direction === dir)
    const shown = list.slice(0, vis)
    return (
      <Panel title={`${title} (${list.length})`}>
        {list.length === 0 ? (
          <Empty>Không có hóa đơn nào trong kỳ đã chọn.</Empty>
        ) : (
          <>
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 92 }}>Ngày</th><th style={{ width: 100 }}>Số HĐ</th>
                  <th>{dir === 'in' ? 'Nhà cung cấp' : 'Khách hàng'}</th>
                  <th style={{ width: 90 }}>Loại</th>
                  {dir === 'in' && <th style={{ width: 90 }}>Khấu trừ</th>}
                  <th className="num" style={{ width: 130 }}>Chưa thuế</th>
                  <th className="num" style={{ width: 120 }}>Thuế</th>
                  <th className="num" style={{ width: 130 }}>Tổng</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td>{dmy(r.invoice_date)}</td>
                    <td>{r.invoice_no || <span className="muted">—</span>}</td>
                    <td>{r.partners?.name || <span className="muted">—</span>}</td>
                    <td>
                      <span className={`badge ${r.category}`}>
                        {r.category === 'goods' ? 'Hàng hóa' : 'Dịch vụ'}
                      </span>
                    </td>
                    {dir === 'in' && (
                      <td>{r.vat_deductible
                        ? <span className="muted">Được</span>
                        : <span className="neg">Không</span>}</td>
                    )}
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{vnd(r.amount_before_tax)}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{vnd(r.tax_amount)}</td>
                    <td className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{vnd(r.amount_total)}</td>
                    <td>
                      <button className="icon-btn" onClick={() => openEdit(r)}>Sửa</button>
                      <button className="icon-btn del" onClick={() => remove(r)}>Xóa</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vis < list.length && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button className="btn ghost sm" onClick={() => setVis(vis + PAGE)}>
                  Hiện thêm ({list.length - vis} còn lại)
                </button>
              </div>
            )}
          </>
        )}
      </Panel>
    )
  }

  // Xuất bảng kê hóa đơn mua vào (mẫu PL 01-1/GTGT) theo kỳ đang lọc.
  function exportListing() {
    setErr('')
    const ins = (rows || []).filter((r) => r.direction === 'in')
    if (ins.length === 0) { setErr('Không có hóa đơn mua vào trong kỳ đã chọn để xuất.'); return }
    const data = ins.map((r) => ({
      invoice_no: r.invoice_no,
      invoice_date: r.invoice_date,
      seller_name: r.partners?.name || '',
      seller_tax_code: r.partners?.tax_code || '',
      amount_before_tax: Number(r.amount_before_tax || 0),
      deductible_tax: Number(r.tax_amount || 0),  // cột thuế của hóa đơn
      vat_deductible: r.vat_deductible,            // quyết định vào nhóm 1 hay nhóm 4
    }))
    exportVatPurchaseListing(data, {
      year: Number(fYear),
      quarter: fQuarter ? Number(fQuarter) : undefined,
    })
  }

  // Xuất bảng kê hóa đơn bán ra (mẫu PL 01-2/GTGT) theo kỳ đang lọc.
  function exportSaleListing() {
    setErr('')
    const outs = (rows || []).filter((r) => r.direction === 'out')
    if (outs.length === 0) { setErr('Không có hóa đơn bán ra trong kỳ đã chọn để xuất.'); return }
    const data = outs.map((r) => {
      const before = Number(r.amount_before_tax || 0)
      const tax = Number(r.tax_amount || 0)
      // suy thuế suất từ tỉ lệ thuế/doanh thu (để phân nhóm). 0 nếu không có thuế.
      let rate = null
      if (before > 0) {
        const pct = Math.round((tax / before) * 100)
        rate = [0, 5, 8, 10].includes(pct) ? pct : (pct === 0 ? 0 : 8)
      } else if (tax === 0) rate = 0
      return {
        invoice_no: r.invoice_no,
        invoice_date: r.invoice_date,
        buyer_name: r.partners?.name || '',
        buyer_tax_code: r.partners?.tax_code || '',
        amount_before_tax: before,
        tax_amount: tax,
        vat_rate: rate,
      }
    })
    exportVatSaleListing(data, {
      year: Number(fYear),
      quarter: fQuarter ? Number(fQuarter) : undefined,
    })
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isOut ? 'Hóa đơn đầu ra' : 'Hóa đơn đầu vào'}</h1>
          <div className="sub">
            {isOut
              ? 'Hóa đơn bán ra. Thuế đầu ra và doanh thu tự tổng hợp ở Báo cáo.'
              : 'Hóa đơn mua vào. Thuế đầu vào được khấu trừ tự tổng hợp ở Báo cáo.'}
          </div>
        </div>
        <div className="btn-row">
          {isOut ? (
            <>
              <button className="btn ghost" onClick={() => setShowOutImport(true)}>Import Excel</button>
              <button className="btn ghost" onClick={exportSaleListing}>Xuất bảng kê bán ra</button>
            </>
          ) : (
            <>
              <button className="btn ghost" onClick={() => setShowInImport(true)}>Import Excel</button>
              <button className="btn ghost" onClick={() => setShowImport(true)}>Import PDF / XML</button>
              <button className="btn ghost" onClick={exportListing}>Xuất bảng kê mua vào</button>
            </>
          )}
          <button className="btn" onClick={openNew}>+ Nhập hóa đơn</button>
        </div>
      </div>

      <Alert>{err}</Alert>

      <div className="toolbar">
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

      {rows === null ? <Loading /> : renderInvoicePanel({
        title: isOut ? 'Hóa đơn đầu ra' : 'Hóa đơn đầu vào',
        dir: direction,
      })}

      {editing && (
        <Modal
          wide
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
                <th style={{ minWidth: 150 }}>Sản phẩm {head.category === 'goods' && '*'}</th>
                <th>Diễn giải</th>
                <th className="num" style={{ width: 64 }}>SL</th>
                <th className="num" style={{ width: 110 }}>Đơn giá</th>
                <th className="num" style={{ width: 66 }}>%VAT</th>
                <th className="num" style={{ width: 120 }}>Thành tiền</th>
                <th className="num" style={{ width: 120 }}>Tiền thuế</th>
                <th className="num" style={{ width: 110 }}>Cộng</th>
                <th style={{ width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const a = lineAmounts(l)
                // giá trị tự tính (để làm placeholder gợi ý khi ô ghi đè trống)
                const autoBefore = Math.round(Number(l.quantity || 0) * Number(l.unit_price || 0))
                const autoTax = Math.round(
                  (l.amount_override !== '' ? Number(l.amount_override) : autoBefore)
                  * Number(l.vat_rate || 0) / 100)
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
                    {/* Thành tiền: trống = tự tính (SL×đơn giá); nhập = ghi đè */}
                    <td>
                      <input type="number" min="0" step="any"
                        value={l.amount_override}
                        placeholder={String(autoBefore)}
                        title="Để trống = tự tính. Nhập số để khớp hóa đơn NCC."
                        style={{ textAlign: 'right' }}
                        onChange={(e) => setLine(i, { amount_override: e.target.value })} />
                    </td>
                    {/* Tiền thuế: trống = tự tính; nhập = ghi đè để khớp hóa đơn */}
                    <td>
                      <input type="number" min="0" step="any"
                        value={l.tax_override}
                        placeholder={String(autoTax)}
                        title="Để trống = tự tính. Nhập số để khớp hóa đơn NCC."
                        style={{ textAlign: 'right' }}
                        onChange={(e) => setLine(i, { tax_override: e.target.value })} />
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{vnd(a.total)}</td>
                    <td>
                      {lines.length > 1 &&
                        <button className="icon-btn del" onClick={() => delLine(i)}>✕</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="btn-row" style={{ marginTop: 10, alignItems: 'center' }}>
            <button className="btn ghost sm" onClick={addLine}>+ Thêm dòng</button>
            <span className="inline-note" style={{ margin: 0 }}>
              Ô “Thành tiền” và “Tiền thuế” để trống sẽ tự tính (số mờ là gợi ý). Nếu hóa
              đơn NCC ghi khác do làm tròn, gõ đè số đúng vào để khớp từng đồng.
            </span>
          </div>

          {head.direction === 'in' && !head.vat_deductible && (
            <div className="alert warn" style={{ marginTop: 12 }}>
              Hóa đơn này không được khấu trừ VAT — toàn bộ tiền thuế sẽ được tính vào
              chi phí, không trừ vào số VAT phải nộp.
            </div>
          )}
        </Modal>
      )}

      {showImport && (
        <InvoiceImport
          partners={partners}
          onClose={() => setShowImport(false)}
          onDone={() => { loadRefs(); load() }}
        />
      )}

      {showOutImport && (
        <Suspense fallback={<div className="spin">Đang tải…</div>}>
          <OutputInvoiceImport
            partners={partners}
            products={products}
            onClose={() => setShowOutImport(false)}
            onDone={() => { loadRefs(); load() }}
          />
        </Suspense>
      )}

      {showInImport && (
        <Suspense fallback={<div className="spin">Đang tải…</div>}>
          <InputInvoiceImport
            partners={partners}
            onClose={() => setShowInImport(false)}
            onDone={() => { loadRefs(); load() }}
          />
        </Suspense>
      )}
    </>
  )
}
