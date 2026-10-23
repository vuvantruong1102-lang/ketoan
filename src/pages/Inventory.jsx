import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Empty, Loading, Modal } from '../components/ui'
import { vnd, num, recentYears } from '../lib/format'

export default function Inventory() {
  const [onhand, setOnhand] = useState(null)
  const [opening, setOpening] = useState([])
  const [products, setProducts] = useState([])
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const yNow = new Date().getFullYear()
  const [year, setYear] = useState(yNow)
  const [quarter, setQuarter] = useState(1)

  const [showOpen, setShowOpen] = useState(false)
  const [oForm, setOForm] = useState({ product_id: '', quantity: 0, unit_cost: 0 })
  const [importErr, setImportErr] = useState('')
  const [importRows, setImportRows] = useState(null)
  const fileRef = useRef()

  async function load() {
    setErr('')
    const [{ data: oh, error: e1 }, { data: op }, { data: pr }] = await Promise.all([
      supabase.from('v_inventory_onhand').select('*').order('sku'),
      supabase.from('inventory_opening').select('*, products(sku,name)')
        .eq('year', year).eq('quarter', quarter),
      supabase.from('products').select('id,sku,name,kind').eq('kind', 'goods').order('sku'),
    ])
    if (e1) setErr(e1.message)
    setOnhand(oh || [])
    setOpening(op || [])
    setProducts(pr || [])
  }
  useEffect(() => { load() }, [year, quarter])

  async function saveOpening() {
    setErr('')
    if (!oForm.product_id) { setErr('Chọn sản phẩm.'); return }
    const payload = {
      product_id: Number(oForm.product_id), year: Number(year), quarter: Number(quarter),
      quantity: Number(oForm.quantity), unit_cost: Number(oForm.unit_cost),
    }
    // upsert theo (product_id, year, quarter)
    const { error } = await supabase.from('inventory_opening')
      .upsert(payload, { onConflict: 'product_id,year,quarter' })
    if (error) { setErr(error.message); return }
    setShowOpen(false); setOForm({ product_id: '', quantity: 0, unit_cost: 0 }); load()
  }

  async function delOpening(r) {
    if (!confirm(`Xóa tồn đầu kỳ của ${r.products?.sku}?`)) return
    await supabase.from('inventory_opening').delete().eq('id', r.id)
    load()
  }

  // ---- Import Excel tồn đầu kỳ ----
  // Cột mong đợi: sku | quantity | unit_cost  (dòng đầu là tiêu đề)
  function onPickFile(e) {
    setImportErr(''); setImportRows(null)
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })
        if (raw.length === 0) { setImportErr('File rỗng.'); return }
        const parsed = raw.map((row, idx) => {
          // chấp nhận tên cột linh hoạt
          const sku = String(row.sku ?? row.SKU ?? row['Mã'] ?? row['ma'] ?? '').trim()
          const quantity = Number(row.quantity ?? row.qty ?? row['SL'] ?? row['so_luong'] ?? 0)
          const unit_cost = Number(row.unit_cost ?? row.cost ?? row['don_gia'] ?? row['DonGia'] ?? 0)
          const product = products.find((p) => p.sku.toLowerCase() === sku.toLowerCase())
          return {
            line: idx + 2, sku, quantity, unit_cost,
            product_id: product?.id || null,
            error: !sku ? 'thiếu SKU' : !product ? 'SKU không khớp sản phẩm' :
              isNaN(quantity) || isNaN(unit_cost) ? 'số không hợp lệ' : null,
          }
        })
        setImportRows(parsed)
      } catch (ex) {
        setImportErr('Không đọc được file: ' + ex.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function doImport() {
    const good = (importRows || []).filter((r) => !r.error)
    if (good.length === 0) { setImportErr('Không có dòng hợp lệ để nhập.'); return }
    const payload = good.map((r) => ({
      product_id: r.product_id, year: Number(year), quarter: Number(quarter),
      quantity: r.quantity, unit_cost: r.unit_cost,
    }))
    const { error } = await supabase.from('inventory_opening')
      .upsert(payload, { onConflict: 'product_id,year,quarter' })
    if (error) { setImportErr(error.message); return }
    setImportRows(null)
    if (fileRef.current) fileRef.current.value = ''
    setOk(`Đã nhập ${good.length} dòng tồn đầu kỳ.`)
    setTimeout(() => setOk(''), 4000)
    load()
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['sku', 'quantity', 'unit_cost'],
      ['SP01', 10, 100000],
      ['SP02', 5, 250000],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'TonDauKy')
    XLSX.writeFile(wb, 'mau_ton_dau_ky.xlsx')
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tồn kho</h1>
          <div className="sub">
            Tồn hiện tại suy ra từ hóa đơn (tồn đầu kỳ + mua − bán). Giá trị tồn chính xác
            sau khi chốt kỳ ở trang Báo cáo.
          </div>
        </div>
      </div>

      <Alert>{err}</Alert>
      {ok && <Alert kind="ok">{ok}</Alert>}

      <Panel title="Tồn kho hiện tại (theo số lượng)">
        {onhand === null ? <Loading /> : onhand.length === 0 ? (
          <Empty>Chưa có sản phẩm hàng hóa nào.</Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th><th>Tên</th><th>ĐVT</th>
                <th className="num">Tồn đầu</th><th className="num">Đã mua</th>
                <th className="num">Đã bán</th><th className="num">Tồn hiện tại</th>
              </tr>
            </thead>
            <tbody>
              {onhand.map((r) => (
                <tr key={r.product_id}>
                  <td style={{ fontWeight: 600 }}>{r.sku}</td>
                  <td>{r.name}</td>
                  <td>{r.unit || <span className="muted">—</span>}</td>
                  <td className="num">{num(r.opening_qty)}</td>
                  <td className="num">{num(r.purchased_qty)}</td>
                  <td className="num">{num(r.sold_qty)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{num(r.onhand_qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title={`Tồn kho đầu kỳ — ${year} / Q${quarter}`}
        actions={
          <div className="btn-row">
            <button className="btn ghost sm" onClick={downloadTemplate}>Tải file mẫu</button>
            <button className="btn sm" onClick={() => setShowOpen(true)}>+ Thêm thủ công</button>
          </div>
        }
      >
        <div className="toolbar">
          <div className="field">
            <label>Năm</label>
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {recentYears().map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Quý</label>
            <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
              <option value="1">Q1</option><option value="2">Q2</option>
              <option value="3">Q3</option><option value="4">Q4</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Import Excel (cột: sku, quantity, unit_cost)</label>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onPickFile} />
          </div>
        </div>

        {importErr && <Alert>{importErr}</Alert>}

        {importRows && (
          <div className="panel" style={{ margin: '4px 0 12px', boxShadow: 'none' }}>
            <div className="panel-body">
              <div style={{ marginBottom: 10 }}>
                Xem trước {importRows.length} dòng ·{' '}
                <span className="pos">{importRows.filter((r) => !r.error).length} hợp lệ</span> ·{' '}
                <span className="neg">{importRows.filter((r) => r.error).length} lỗi</span>
              </div>
              <table className="grid">
                <thead>
                  <tr><th>Dòng</th><th>SKU</th><th className="num">SL</th>
                    <th className="num">Đơn giá vốn</th><th>Tình trạng</th></tr>
                </thead>
                <tbody>
                  {importRows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.line}</td><td>{r.sku}</td>
                      <td className="num">{num(r.quantity)}</td>
                      <td className="num">{vnd(r.unit_cost)}</td>
                      <td>{r.error
                        ? <span className="neg">{r.error}</span>
                        : <span className="pos">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn accent sm" onClick={doImport}>
                  Nhập {importRows.filter((r) => !r.error).length} dòng hợp lệ
                </button>
                <button className="btn ghost sm" onClick={() => setImportRows(null)}>Hủy</button>
              </div>
              <div className="inline-note">
                Dòng trùng SKU trong cùng kỳ sẽ ghi đè giá trị cũ.
              </div>
            </div>
          </div>
        )}

        {opening.length === 0 ? (
          <Empty>Chưa khai báo tồn đầu kỳ cho {year}/Q{quarter}.</Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr><th>SKU</th><th>Tên</th><th className="num">Số lượng</th>
                <th className="num">Đơn giá vốn</th><th className="num">Giá trị</th>
                <th style={{ width: 50 }}></th></tr>
            </thead>
            <tbody>
              {opening.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.products?.sku}</td>
                  <td>{r.products?.name}</td>
                  <td className="num">{num(r.quantity)}</td>
                  <td className="num">{vnd(r.unit_cost)}</td>
                  <td className="num">{vnd(r.quantity * r.unit_cost)}</td>
                  <td><button className="icon-btn del" onClick={() => delOpening(r)}>Xóa</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {showOpen && (
        <Modal
          title={`Thêm tồn đầu kỳ — ${year}/Q${quarter}`}
          onClose={() => setShowOpen(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setShowOpen(false)}>Hủy</button>
              <button className="btn accent" onClick={saveOpening}>Lưu</button>
            </>
          }
        >
          <div className="field">
            <label>Sản phẩm *</label>
            <select value={oForm.product_id}
              onChange={(e) => setOForm({ ...oForm, product_id: e.target.value })}>
              <option value="">— Chọn —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
            </select>
          </div>
          <div className="row c2">
            <div className="field">
              <label>Số lượng</label>
              <input type="number" step="any" value={oForm.quantity}
                onChange={(e) => setOForm({ ...oForm, quantity: e.target.value })} />
            </div>
            <div className="field">
              <label>Đơn giá vốn</label>
              <input type="number" step="any" value={oForm.unit_cost}
                onChange={(e) => setOForm({ ...oForm, unit_cost: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
