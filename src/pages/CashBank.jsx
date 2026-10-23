import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Empty, Loading, Modal } from '../components/ui'
import { vnd, dmy, recentYears } from '../lib/format'

const today = () => new Date().toISOString().slice(0, 10)

function BookSection({ table, title, extraField }) {
  const [rows, setRows] = useState(null)
  const [partners, setPartners] = useState([])
  const [err, setErr] = useState('')
  const [show, setShow] = useState(false)
  const yNow = new Date().getFullYear()
  const [year, setYear] = useState(yNow)
  const blank = {
    tx_date: today(), direction: 'in', amount: 0, description: '',
    partner_id: '', bank_account: '',
  }
  const [form, setForm] = useState(blank)

  async function load() {
    setErr('')
    const { data, error } = await supabase.from(table)
      .select('*, partners(name)')
      .gte('tx_date', `${year}-01-01`).lte('tx_date', `${year}-12-31`)
      .order('tx_date', { ascending: true }).order('id', { ascending: true })
    if (error) setErr(error.message)
    else setRows(data)
  }
  async function loadPartners() {
    const { data } = await supabase.from('partners').select('id,name').order('name')
    setPartners(data || [])
  }
  useEffect(() => { loadPartners() }, [])
  useEffect(() => { load() }, [year])

  async function save() {
    setErr('')
    if (!form.tx_date || !(Number(form.amount) > 0)) {
      setErr('Nhập ngày và số tiền lớn hơn 0.'); return
    }
    const payload = {
      tx_date: form.tx_date, direction: form.direction,
      amount: Number(form.amount), description: form.description.trim() || null,
      partner_id: form.partner_id || null,
    }
    if (extraField) payload.bank_account = form.bank_account.trim() || null
    const { error } = await supabase.from(table).insert(payload)
    if (error) { setErr(error.message); return }
    setShow(false); setForm(blank); load()
  }

  async function remove(r) {
    if (!confirm('Xóa giao dịch này?')) return
    await supabase.from(table).delete().eq('id', r.id)
    load()
  }

  // số dư lũy kế
  const withBalance = useMemo(() => {
    let bal = 0
    return (rows || []).map((r) => {
      bal += r.direction === 'in' ? Number(r.amount) : -Number(r.amount)
      return { ...r, balance: bal }
    })
  }, [rows])

  const totalIn = (rows || []).filter((r) => r.direction === 'in')
    .reduce((s, r) => s + Number(r.amount), 0)
  const totalOut = (rows || []).filter((r) => r.direction === 'out')
    .reduce((s, r) => s + Number(r.amount), 0)

  return (
    <Panel
      title={title}
      actions={<button className="btn sm" onClick={() => setShow(true)}>+ Ghi giao dịch</button>}
    >
      <Alert>{err}</Alert>
      <div className="toolbar">
        <div className="field">
          <label>Năm</label>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {recentYears().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, alignItems: 'center' }}>
          <div><span className="muted">Thu: </span><b className="pos">{vnd(totalIn)}</b></div>
          <div><span className="muted">Chi: </span><b className="neg">{vnd(totalOut)}</b></div>
          <div><span className="muted">Số dư: </span><b>{vnd(totalIn - totalOut)}</b></div>
        </div>
      </div>

      {rows === null ? <Loading /> : withBalance.length === 0 ? (
        <Empty>Chưa có giao dịch nào trong năm {year}.</Empty>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Ngày</th><th>Diễn giải</th><th>Đối tác</th>
              {extraField && <th>Tài khoản</th>}
              <th className="num">Thu</th><th className="num">Chi</th>
              <th className="num">Số dư</th><th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {withBalance.map((r) => (
              <tr key={r.id}>
                <td>{dmy(r.tx_date)}</td>
                <td>{r.description || <span className="muted">—</span>}</td>
                <td>{r.partners?.name || <span className="muted">—</span>}</td>
                {extraField && <td>{r.bank_account || <span className="muted">—</span>}</td>}
                <td className="num pos">{r.direction === 'in' ? vnd(r.amount) : ''}</td>
                <td className="num neg">{r.direction === 'out' ? vnd(r.amount) : ''}</td>
                <td className="num" style={{ fontWeight: 600 }}>{vnd(r.balance)}</td>
                <td><button className="icon-btn del" onClick={() => remove(r)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {show && (
        <Modal
          title={`Ghi giao dịch — ${title}`}
          onClose={() => setShow(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setShow(false)}>Hủy</button>
              <button className="btn accent" onClick={save}>Lưu</button>
            </>
          }
        >
          <div className="row c3">
            <div className="field">
              <label>Ngày *</label>
              <input type="date" value={form.tx_date}
                onChange={(e) => setForm({ ...form, tx_date: e.target.value })} />
            </div>
            <div className="field">
              <label>Loại *</label>
              <select value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                <option value="in">Thu</option>
                <option value="out">Chi</option>
              </select>
            </div>
            <div className="field">
              <label>Số tiền *</label>
              <input type="number" step="any" min="0" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
          </div>
          {extraField && (
            <div className="field">
              <label>Tài khoản / Ngân hàng</label>
              <input placeholder="VD: Vietcombank 0123…" value={form.bank_account}
                onChange={(e) => setForm({ ...form, bank_account: e.target.value })} />
            </div>
          )}
          <div className="field">
            <label>Diễn giải</label>
            <input value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="field">
            <label>Đối tác (tùy chọn — để tự đối chiếu)</label>
            <select value={form.partner_id}
              onChange={(e) => setForm({ ...form, partner_id: e.target.value })}>
              <option value="">— Không —</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </Modal>
      )}
    </Panel>
  )
}

export default function CashBank() {
  const [tab, setTab] = useState('cash')
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tiền mặt & Ngân hàng</h1>
          <div className="sub">Ghi lại giao dịch thu/chi và theo dõi số dư. Hai sổ độc lập.</div>
        </div>
        <div className="btn-row">
          <button className={`btn ${tab === 'cash' ? '' : 'ghost'} sm`} onClick={() => setTab('cash')}>
            Sổ tiền mặt
          </button>
          <button className={`btn ${tab === 'bank' ? '' : 'ghost'} sm`} onClick={() => setTab('bank')}>
            Sổ ngân hàng
          </button>
        </div>
      </div>

      {tab === 'cash'
        ? <BookSection table="cash_book" title="Sổ quỹ tiền mặt" extraField={false} />
        : <BookSection table="bank_book" title="Sổ ngân hàng" extraField={true} />}
    </>
  )
}
