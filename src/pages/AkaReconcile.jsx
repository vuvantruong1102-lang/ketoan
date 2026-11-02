import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Empty, Loading } from '../components/ui'
import { vnd, dmy } from '../lib/format'

const today = () => new Date().toISOString().slice(0, 10)

export default function AkaReconcile() {
  const [settings, setSettings] = useState(null)   // {opening_balance, name_filter}
  const [deposits, setDeposits] = useState([])     // giao dịch NH chi cho AKA
  const [excluded, setExcluded] = useState(new Set())
  const [acceptances, setAcceptances] = useState([])
  const [manualDeps, setManualDeps] = useState([])   // nạp tay
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  // form nạp tay
  const [depForm, setDepForm] = useState({ tx_date: today(), amount: '', description: '' })

  // form cấu hình
  const [openInput, setOpenInput] = useState('')
  const [filterInput, setFilterInput] = useState('')
  const [savingCfg, setSavingCfg] = useState(false)
  // form nghiệm thu
  const [accForm, setAccForm] = useState({ tx_date: today(), amount: '', description: '' })

  async function load() {
    setErr('')
    // 1. settings
    const { data: cfg } = await supabase.from('aka_settings').select('*').eq('id', 1).maybeSingle()
    const s = cfg || { opening_balance: 0, name_filter: 'AKA MEDIA' }
    setSettings(s)
    setOpenInput(s.opening_balance ? String(s.opening_balance) : '')
    setFilterInput(s.name_filter || 'AKA MEDIA')

    // 2. giao dịch NH chi cho AKA (lọc theo tên đối ứng, chiều out)
    const filter = (s.name_filter || 'AKA MEDIA').trim()
    const { data: tx, error: e2 } = await supabase.from('bank_tx')
      .select('id, tx_date, tx_at, amount, counterparty, description, bank_accounts(name)')
      .eq('direction', 'out')
      .ilike('counterparty', `%${filter}%`)
      .order('tx_date', { ascending: true })
    if (e2) setErr(e2.message)
    setDeposits(tx || [])

    // 3. danh sách loại trừ (nhận nhầm)
    const { data: ex } = await supabase.from('aka_excluded').select('bank_tx_id')
    setExcluded(new Set((ex || []).map((r) => r.bank_tx_id)))

    // 4. nghiệm thu
    const { data: acc } = await supabase.from('aka_acceptance').select('*')
      .order('tx_date', { ascending: true }).order('id', { ascending: true })
    setAcceptances(acc || [])

    // 5. nạp tay
    const { data: dep } = await supabase.from('aka_deposit').select('*')
      .order('tx_date', { ascending: true }).order('id', { ascending: true })
    setManualDeps(dep || [])
  }
  useEffect(() => { load() }, [])

  async function saveCfg() {
    setErr(''); setOk(''); setSavingCfg(true)
    const { error } = await supabase.from('aka_settings').upsert({
      id: 1,
      opening_balance: Number(openInput || 0),
      name_filter: filterInput.trim() || 'AKA MEDIA',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    setSavingCfg(false)
    if (error) { setErr(error.message); return }
    setOk('Đã lưu cấu hình.')
    setTimeout(() => setOk(''), 3000)
    load()
  }

  async function toggleExclude(txId, exclude) {
    if (exclude) await supabase.from('aka_excluded').insert({ bank_tx_id: txId })
    else await supabase.from('aka_excluded').delete().eq('bank_tx_id', txId)
    load()
  }

  async function addDep() {
    setErr('')
    if (!depForm.tx_date || !(Number(depForm.amount) > 0)) { setErr('Nhập ngày và số tiền > 0.'); return }
    const { error } = await supabase.from('aka_deposit').insert({
      tx_date: depForm.tx_date, amount: Number(depForm.amount),
      description: depForm.description.trim() || null,
    })
    if (error) { setErr(error.message); return }
    setDepForm({ tx_date: depForm.tx_date, amount: '', description: '' })
    load()
  }
  async function delDep(r) {
    if (!confirm('Xóa khoản nạp tay này?')) return
    await supabase.from('aka_deposit').delete().eq('id', r.id)
    load()
  }

  async function addAcc() {
    setErr('')
    if (!accForm.tx_date || !(Number(accForm.amount) > 0)) { setErr('Nhập ngày và số tiền > 0.'); return }
    const { error } = await supabase.from('aka_acceptance').insert({
      tx_date: accForm.tx_date, amount: Number(accForm.amount),
      description: accForm.description.trim() || null,
    })
    if (error) { setErr(error.message); return }
    setAccForm({ tx_date: accForm.tx_date, amount: '', description: '' })
    load()
  }
  async function delAcc(r) {
    if (!confirm('Xóa khoản nghiệm thu này?')) return
    await supabase.from('aka_acceptance').delete().eq('id', r.id)
    load()
  }

  // giao dịch nạp hợp lệ (không bị loại trừ)
  const validDeposits = useMemo(
    () => deposits.filter((d) => !excluded.has(d.id)), [deposits, excluded])
  const bankDeposit = validDeposits.reduce((s, d) => s + Number(d.amount), 0)
  const manualDeposit = manualDeps.reduce((s, r) => s + Number(r.amount), 0)
  const totalDeposit = bankDeposit + manualDeposit
  const totalAcc = acceptances.reduce((s, r) => s + Number(r.amount), 0)
  const opening = Number(settings?.opening_balance || 0)
  const balance = opening + totalDeposit - totalAcc

  if (settings === null) return <Loading />

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Đối soát Facebook AKA Media</h1>
          <div className="sub">Tiền nạp lấy tự động từ giao dịch chi cho AKA trong sổ ngân hàng. Nghiệm thu nhập tay.</div>
        </div>
      </div>

      <Alert>{err}</Alert>
      {ok && <Alert kind="ok">{ok}</Alert>}

      {/* số dư tổng quan */}
      <div className="kpis">
        <div className="kpi"><div className="label">Số dư đầu</div><div className="value">{vnd(opening)}</div></div>
        <div className="kpi"><div className="label">Tổng nạp (NH + tay)</div>
          <div className="value pos">{vnd(totalDeposit)}</div></div>
        <div className="kpi"><div className="label">Tổng nghiệm thu</div><div className="value neg">{vnd(totalAcc)}</div></div>
        <div className="kpi"><div className="label">Số dư hiện tại</div>
          <div className={`value ${balance >= 0 ? '' : 'neg'}`}>{vnd(balance)}</div></div>
      </div>

      {/* cấu hình */}
      <Panel title="Cấu hình">
        <div className="row c3" style={{ alignItems: 'end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Số dư đầu kỳ</label>
            <input type="number" step="any" value={openInput} placeholder="0"
              onChange={(e) => setOpenInput(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Lọc TK đối ứng chứa chữ</label>
            <input value={filterInput} placeholder="AKA MEDIA"
              onChange={(e) => setFilterInput(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <button className="btn sm" onClick={saveCfg} disabled={savingCfg}>
              {savingCfg ? 'Đang lưu…' : 'Lưu cấu hình'}
            </button>
          </div>
        </div>
        <div className="inline-note" style={{ marginTop: 8 }}>
          Giao dịch nạp = giao dịch CHI (tiền ra) trong sổ ngân hàng có tên TK đối ứng chứa chuỗi trên.
        </div>
      </Panel>

      {/* giao dịch nạp (từ ngân hàng) */}
      <Panel title={`Giao dịch nạp — tự lấy từ ngân hàng (${validDeposits.length})`}>
        {deposits.length === 0 ? (
          <Empty>
            Chưa tìm thấy giao dịch chi cho “{settings.name_filter}” trong sổ ngân hàng.
            Hãy nhập/import sao kê có TK đối ứng là AKA Media.
          </Empty>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 92 }}>Ngày</th>
                <th>TK đối ứng</th>
                <th>Nội dung</th>
                <th style={{ width: 90 }}>Tài khoản</th>
                <th className="num" style={{ width: 150 }}>Số tiền nạp</th>
                <th style={{ width: 90 }}>Tính?</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => {
                const isExcluded = excluded.has(d.id)
                return (
                  <tr key={d.id} style={isExcluded ? { opacity: 0.5 } : undefined}>
                    <td>{dmy(d.tx_date)}</td>
                    <td>{d.counterparty}</td>
                    <td>{d.description || <span className="muted">—</span>}</td>
                    <td>{d.bank_accounts?.name || <span className="muted">—</span>}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{vnd(d.amount)}</td>
                    <td>
                      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
                        <input type="checkbox" checked={!isExcluded}
                          onChange={(e) => toggleExclude(d.id, !e.target.checked)} />
                        {isExcluded ? <span className="muted">bỏ</span> : 'có'}
                      </label>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className="inline-note" style={{ marginTop: 8 }}>
          Bỏ tick cột “Tính?” nếu giao dịch nhận nhầm — nó sẽ không cộng vào tổng nạp.
        </div>
      </Panel>

      {/* nạp tay (ngoài ngân hàng) */}
      <Panel title={`Giao dịch nạp — nhập tay (${manualDeps.length})`}>
        <div className="row c3" style={{ alignItems: 'end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Ngày</label>
            <input type="date" value={depForm.tx_date}
              onChange={(e) => setDepForm({ ...depForm, tx_date: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Số tiền nạp</label>
            <input type="number" step="any" min="0" value={depForm.amount}
              onChange={(e) => setDepForm({ ...depForm, amount: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <button className="btn accent sm" style={{ width: '100%' }} onClick={addDep}>+ Thêm</button>
          </div>
        </div>
        <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <label>Nội dung</label>
          <input value={depForm.description}
            onChange={(e) => setDepForm({ ...depForm, description: e.target.value })} />
        </div>

        <table className="grid" style={{ marginTop: 14 }}>
          <thead>
            <tr><th style={{ width: 100 }}>Ngày</th><th>Nội dung</th>
              <th className="num" style={{ width: 150 }}>Số tiền</th><th style={{ width: 28 }}></th></tr>
          </thead>
          <tbody>
            {manualDeps.length === 0 ? (
              <tr><td colSpan={4}><Empty>Chưa có khoản nạp tay nào.</Empty></td></tr>
            ) : manualDeps.map((r) => (
              <tr key={r.id}>
                <td>{dmy(r.tx_date)}</td>
                <td>{r.description || <span className="muted">—</span>}</td>
                <td className="num" style={{ fontWeight: 600 }}>{vnd(r.amount)}</td>
                <td><button className="icon-btn del" onClick={() => delDep(r)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inline-note" style={{ marginTop: 8 }}>
          Dùng cho lần nạp không đi qua sổ ngân hàng. Cộng chung vào tổng nạp.
        </div>
      </Panel>

      {/* nghiệm thu (chi, nhập tay) */}
      <Panel title="Nghiệm thu (nhập tay)">
        <div className="row c3" style={{ alignItems: 'end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Ngày</label>
            <input type="date" value={accForm.tx_date}
              onChange={(e) => setAccForm({ ...accForm, tx_date: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Số tiền nghiệm thu</label>
            <input type="number" step="any" min="0" value={accForm.amount}
              onChange={(e) => setAccForm({ ...accForm, amount: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <button className="btn accent sm" style={{ width: '100%' }} onClick={addAcc}>+ Thêm</button>
          </div>
        </div>
        <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <label>Nội dung</label>
          <input value={accForm.description}
            onChange={(e) => setAccForm({ ...accForm, description: e.target.value })} />
        </div>

        <table className="grid" style={{ marginTop: 14 }}>
          <thead>
            <tr><th style={{ width: 100 }}>Ngày</th><th>Nội dung</th>
              <th className="num" style={{ width: 150 }}>Số tiền</th><th style={{ width: 28 }}></th></tr>
          </thead>
          <tbody>
            {acceptances.length === 0 ? (
              <tr><td colSpan={4}><Empty>Chưa có khoản nghiệm thu nào.</Empty></td></tr>
            ) : acceptances.map((r) => (
              <tr key={r.id}>
                <td>{dmy(r.tx_date)}</td>
                <td>{r.description || <span className="muted">—</span>}</td>
                <td className="num" style={{ fontWeight: 600 }}>{vnd(r.amount)}</td>
                <td><button className="icon-btn del" onClick={() => delAcc(r)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  )
}
