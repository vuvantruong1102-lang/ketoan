import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Empty, Loading } from '../components/ui'
import { vnd, dmy, recentYears } from '../lib/format'

const today = () => new Date().toISOString().slice(0, 10)
const PRESETS = ['Bán hàng', 'Quản lý']

export default function Expenses() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const yNow = new Date().getFullYear()
  const [fYear, setFYear] = useState(yNow)
  const [fQuarter, setFQuarter] = useState('')

  const [form, setForm] = useState({ exp_date: today(), amount: '', category: 'Bán hàng', description: '' })
  const [customCat, setCustomCat] = useState('')   // khi chọn "Loại khác…"

  async function load() {
    setErr('')
    const y = Number(fYear)
    let from = `${y}-01-01`, to = `${y + 1}-01-01`
    if (fQuarter) {
      const q = Number(fQuarter); const m0 = (q - 1) * 3
      from = `${y}-${String(m0 + 1).padStart(2, '0')}-01`
      const nm = m0 + 3
      to = nm >= 12 ? `${y + 1}-01-01` : `${y}-${String(nm + 1).padStart(2, '0')}-01`
    }
    const { data, error } = await supabase.from('expenses').select('*')
      .gte('exp_date', from).lt('exp_date', to)
      .order('exp_date', { ascending: false }).order('id', { ascending: false })
    if (error) setErr(error.message)
    else setRows(data)
  }
  useEffect(() => { load() }, [fYear, fQuarter])

  // danh sách loại đã dùng (để gợi ý trong dropdown)
  const knownCats = useMemo(() => {
    const s = new Set(PRESETS)
    for (const r of rows || []) if (r.category) s.add(r.category)
    return Array.from(s)
  }, [rows])

  async function add() {
    setErr('')
    const cat = form.category === '__custom__' ? customCat.trim() : form.category
    if (!form.exp_date || !(Number(form.amount) > 0)) { setErr('Nhập ngày và số tiền > 0.'); return }
    if (!cat) { setErr('Chọn hoặc nhập loại chi phí.'); return }
    const { error } = await supabase.from('expenses').insert({
      exp_date: form.exp_date, amount: Number(form.amount),
      category: cat, description: form.description.trim() || null,
    })
    if (error) { setErr(error.message); return }
    setForm({ exp_date: form.exp_date, amount: '', category: cat, description: '' })
    setCustomCat('')
    load()
  }

  async function remove(r) {
    if (!confirm(`Xóa chi phí ngày ${dmy(r.exp_date)} (${vnd(r.amount)})?`)) return
    await supabase.from('expenses').delete().eq('id', r.id)
    load()
  }

  const total = (rows || []).reduce((s, r) => s + Number(r.amount), 0)
  const byCat = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) m.set(r.category, (m.get(r.category) || 0) + Number(r.amount))
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [rows])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chi phí</h1>
          <div className="sub">Chi phí bán hàng, quản lý và loại khác. Tự cộng vào Kết quả kinh doanh.</div>
        </div>
      </div>

      <Alert>{err}</Alert>

      <Panel title="Thêm chi phí">
        <div className="row c4" style={{ alignItems: 'end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Ngày</label>
            <input type="date" value={form.exp_date}
              onChange={(e) => setForm({ ...form, exp_date: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Số tiền</label>
            <input type="number" step="any" min="0" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Loại chi phí</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {knownCats.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="__custom__">+ Loại khác…</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <button className="btn accent sm" style={{ width: '100%' }} onClick={add}>+ Thêm</button>
          </div>
        </div>
        {form.category === '__custom__' && (
          <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
            <label>Tên loại chi phí mới</label>
            <input value={customCat} onChange={(e) => setCustomCat(e.target.value)}
              placeholder="VD: Chi phí tài chính" />
          </div>
        )}
        <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <label>Nội dung</label>
          <input value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </Panel>

      <Panel
        title="Danh sách chi phí"
        actions={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="muted">Tổng: </span><b>{vnd(total)}</b>
          </div>
        }
      >
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
          {byCat.length > 0 && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              {byCat.map(([c, v]) => (
                <span key={c}><span className="muted">{c}: </span><b>{vnd(v)}</b></span>
              ))}
            </div>
          )}
        </div>

        {rows === null ? <Loading /> : rows.length === 0 ? (
          <Empty>Chưa có chi phí trong kỳ đã chọn.</Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Ngày</th>
                <th style={{ width: 140 }}>Loại</th>
                <th>Nội dung</th>
                <th className="num" style={{ width: 150 }}>Số tiền</th>
                <th style={{ width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{dmy(r.exp_date)}</td>
                  <td><span className="badge goods">{r.category}</span></td>
                  <td>{r.description || <span className="muted">—</span>}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{vnd(r.amount)}</td>
                  <td><button className="icon-btn del" onClick={() => remove(r)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  )
}
