import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Empty, Loading, Modal } from '../components/ui'

const blank = {
  name: '', tax_code: '', address: '', phone: '',
  is_supplier: true, is_customer: false, note: '',
}

export default function Partners() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(null) // object or null
  const [form, setForm] = useState(blank)
  const [q, setQ] = useState('')

  async function load() {
    setErr('')
    const { data, error } = await supabase
      .from('partners').select('*').order('name')
    if (error) setErr(error.message)
    else setRows(data)
  }
  useEffect(() => { load() }, [])

  function openNew() { setForm(blank); setEditing('new') }
  function openEdit(r) {
    setForm({
      name: r.name, tax_code: r.tax_code || '', address: r.address || '',
      phone: r.phone || '', is_supplier: r.is_supplier,
      is_customer: r.is_customer, note: r.note || '',
    })
    setEditing(r)
  }

  async function save() {
    setErr('')
    if (!form.name.trim()) { setErr('Tên đối tác không được trống.'); return }
    const payload = { ...form, name: form.name.trim() }
    let error
    if (editing === 'new') {
      ({ error } = await supabase.from('partners').insert(payload))
    } else {
      ({ error } = await supabase.from('partners').update(payload).eq('id', editing.id))
    }
    if (error) { setErr(error.message); return }
    setEditing(null); load()
  }

  async function remove(r) {
    if (!confirm(`Xóa đối tác "${r.name}"?`)) return
    const { error } = await supabase.from('partners').delete().eq('id', r.id)
    if (error) setErr('Không xóa được — có thể đối tác đang gắn với hóa đơn.')
    else load()
  }

  const filtered = (rows || []).filter(
    (r) => !q ||
      r.name.toLowerCase().includes(q.toLowerCase()) ||
      (r.tax_code || '').includes(q)
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Đối tác</h1>
          <div className="sub">Nhà cung cấp và khách hàng dùng chung danh mục này</div>
        </div>
        <button className="btn" onClick={openNew}>+ Thêm đối tác</button>
      </div>

      <Alert>{err}</Alert>

      <div className="toolbar">
        <div className="field">
          <label>Tìm kiếm</label>
          <input placeholder="Tên hoặc MST…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <Panel>
        {rows === null ? <Loading /> : filtered.length === 0 ? (
          <Empty>Chưa có đối tác nào. Bấm “Thêm đối tác” để bắt đầu.</Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Tên</th><th>MST</th><th>Điện thoại</th>
                <th>Vai trò</th><th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.name}</div>
                    {r.address && <div className="muted" style={{ fontSize: 12 }}>{r.address}</div>}
                  </td>
                  <td>{r.tax_code || <span className="muted">—</span>}</td>
                  <td>{r.phone || <span className="muted">—</span>}</td>
                  <td>
                    {r.is_supplier && <span className="badge in" style={{ marginRight: 4 }}>NCC</span>}
                    {r.is_customer && <span className="badge out">Khách hàng</span>}
                  </td>
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
          title={editing === 'new' ? 'Thêm đối tác' : 'Sửa đối tác'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEditing(null)}>Hủy</button>
              <button className="btn accent" onClick={save}>Lưu</button>
            </>
          }
        >
          <div className="field">
            <label>Tên đối tác *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="row c2">
            <div className="field">
              <label>Mã số thuế</label>
              <input value={form.tax_code} onChange={(e) => setForm({ ...form, tax_code: e.target.value })} />
            </div>
            <div className="field">
              <label>Điện thoại</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Địa chỉ</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="row c2">
            <div className="field">
              <label>Vai trò</label>
              <label style={{ fontWeight: 400, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={form.is_supplier}
                  onChange={(e) => setForm({ ...form, is_supplier: e.target.checked })} />
                Nhà cung cấp
              </label>
              <label style={{ fontWeight: 400, display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <input type="checkbox" checked={form.is_customer}
                  onChange={(e) => setForm({ ...form, is_customer: e.target.checked })} />
                Khách hàng
              </label>
            </div>
            <div className="field">
              <label>Ghi chú</label>
              <textarea rows={3} value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
