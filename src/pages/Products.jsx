import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Empty, Loading, Modal } from '../components/ui'

const blank = { sku: '', name: '', unit: '', kind: 'goods', note: '', is_active: true }

export default function Products() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(blank)
  const [q, setQ] = useState('')

  async function load() {
    setErr('')
    const { data, error } = await supabase.from('products').select('*').order('sku')
    if (error) setErr(error.message)
    else setRows(data)
  }
  useEffect(() => { load() }, [])

  function openNew() { setForm(blank); setEditing('new') }
  function openEdit(r) {
    setForm({ sku: r.sku, name: r.name, unit: r.unit || '', kind: r.kind, note: r.note || '', is_active: r.is_active })
    setEditing(r)
  }

  async function save() {
    setErr('')
    if (!form.sku.trim() || !form.name.trim()) { setErr('SKU và tên sản phẩm là bắt buộc.'); return }
    const payload = { ...form, sku: form.sku.trim(), name: form.name.trim() }
    let error
    if (editing === 'new') ({ error } = await supabase.from('products').insert(payload))
    else ({ error } = await supabase.from('products').update(payload).eq('id', editing.id))
    if (error) {
      setErr(error.code === '23505' ? 'SKU này đã tồn tại.' : error.message); return
    }
    setEditing(null); load()
  }

  async function remove(r) {
    if (!confirm(`Xóa sản phẩm "${r.name}" (${r.sku})?`)) return
    const { error } = await supabase.from('products').delete().eq('id', r.id)
    if (error) setErr('Không xóa được — có thể sản phẩm đang gắn với hóa đơn hoặc tồn kho.')
    else load()
  }

  const filtered = (rows || []).filter(
    (r) => !q || r.sku.toLowerCase().includes(q.toLowerCase()) ||
      r.name.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sản phẩm</h1>
          <div className="sub">Mỗi sản phẩm có một mã SKU. Hàng hóa có tồn kho; dịch vụ thì không.</div>
        </div>
        <button className="btn" onClick={openNew}>+ Thêm sản phẩm</button>
      </div>

      <Alert>{err}</Alert>

      <div className="toolbar">
        <div className="field">
          <label>Tìm kiếm</label>
          <input placeholder="SKU hoặc tên…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <Panel>
        {rows === null ? <Loading /> : filtered.length === 0 ? (
          <Empty>Chưa có sản phẩm nào.</Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>SKU</th><th>Tên</th><th>ĐVT</th><th>Loại</th>
                <th>Trạng thái</th><th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.sku}</td>
                  <td>{r.name}</td>
                  <td>{r.unit || <span className="muted">—</span>}</td>
                  <td>
                    <span className={`badge ${r.kind}`}>
                      {r.kind === 'goods' ? 'Hàng hóa' : 'Dịch vụ'}
                    </span>
                  </td>
                  <td>{r.is_active ? 'Đang dùng' : <span className="muted">Ngừng</span>}</td>
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
          title={editing === 'new' ? 'Thêm sản phẩm' : 'Sửa sản phẩm'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEditing(null)}>Hủy</button>
              <button className="btn accent" onClick={save}>Lưu</button>
            </>
          }
        >
          <div className="row c2">
            <div className="field">
              <label>SKU *</label>
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div className="field">
              <label>Đơn vị tính</label>
              <input placeholder="cái, hộp, kg…" value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Tên sản phẩm *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="row c2">
            <div className="field">
              <label>Loại</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="goods">Hàng hóa (có tồn kho)</option>
                <option value="service">Dịch vụ (không tồn kho)</option>
              </select>
            </div>
            <div className="field">
              <label>Trạng thái</label>
              <select value={form.is_active ? '1' : '0'}
                onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
                <option value="1">Đang dùng</option>
                <option value="0">Ngừng dùng</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Ghi chú</label>
            <textarea rows={2} value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
        </Modal>
      )}
    </>
  )
}
