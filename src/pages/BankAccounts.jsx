import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Empty, Loading, Modal } from '../components/ui'
import { vnd, dmy } from '../lib/format'
import { readStatementFile } from '../lib/statementImport'

const today = () => new Date().toISOString().slice(0, 10)

export default function BankAccounts() {
  const [accounts, setAccounts] = useState(null)
  const [selId, setSelId] = useState(null)
  const [txs, setTxs] = useState([])
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  // modal thêm/sửa tài khoản
  const [accModal, setAccModal] = useState(null)   // 'new' | account | null
  const [accForm, setAccForm] = useState({ name: '', bank: '', account_no: '', opening_balance: 0, note: '' })

  // form giao dịch tay
  const [txForm, setTxForm] = useState({ tx_date: today(), tx_time: '', direction: 'in', amount: '', description: '', counterparty: '' })

  // import sao kê
  const [showImport, setShowImport] = useState(false)
  const [impBusy, setImpBusy] = useState(false)
  const [impRows, setImpRows] = useState([])
  const [impErr, setImpErr] = useState('')
  const [savingImp, setSavingImp] = useState(false)
  const fileRef = useRef()

  async function loadAccounts() {
    setErr('')
    const { data, error } = await supabase.from('bank_accounts').select('*').order('id')
    if (error) { setErr(error.message); return }
    setAccounts(data)
    if (data.length && !selId) setSelId(data[0].id)
  }
  async function loadTxs(accId) {
    if (!accId) { setTxs([]); return }
    const { data, error } = await supabase.from('bank_tx').select('*')
      .eq('account_id', accId)
      .order('tx_at', { ascending: true, nullsFirst: true })
      .order('tx_date', { ascending: true })
      .order('id', { ascending: true })
    if (error) { setErr(error.message); return }
    setTxs(data)
  }
  useEffect(() => { loadAccounts() }, [])
  useEffect(() => { loadTxs(selId) }, [selId])

  const selected = (accounts || []).find((a) => a.id === selId)

  // số dư của 1 tài khoản = đầu kỳ + thu - chi
  function balanceOf(accId, opening) {
    // chỉ tính được chính xác cho TK đang chọn (đã tải txs); với TK khác hiển thị đầu kỳ
    return opening
  }

  // số dư lũy kế cho TK đang chọn
  const txsWithBalance = useMemo(() => {
    let bal = Number(selected?.opening_balance || 0)
    return txs.map((t) => {
      bal += t.direction === 'in' ? Number(t.amount) : -Number(t.amount)
      return { ...t, balance: bal }
    })
  }, [txs, selected])

  const closingBalance = txsWithBalance.length
    ? txsWithBalance[txsWithBalance.length - 1].balance
    : Number(selected?.opening_balance || 0)

  // ---- tài khoản ----
  function openNewAcc() {
    setAccForm({ name: '', bank: '', account_no: '', opening_balance: 0, note: '' })
    setAccModal('new')
  }
  function openEditAcc(a) {
    setAccForm({
      name: a.name, bank: a.bank || '', account_no: a.account_no || '',
      opening_balance: a.opening_balance, note: a.note || '',
    })
    setAccModal(a)
  }
  async function saveAcc() {
    setErr('')
    if (!accForm.name.trim()) { setErr('Nhập tên tài khoản.'); return }
    const payload = {
      name: accForm.name.trim(), bank: accForm.bank.trim() || null,
      account_no: accForm.account_no.trim() || null,
      opening_balance: Number(accForm.opening_balance) || 0,
      note: accForm.note.trim() || null,
    }
    let error, newId
    if (accModal === 'new') {
      const res = await supabase.from('bank_accounts').insert(payload).select('id').single()
      error = res.error; newId = res.data?.id
    } else {
      error = (await supabase.from('bank_accounts').update(payload).eq('id', accModal.id)).error
    }
    if (error) { setErr(error.message); return }
    setAccModal(null)
    await loadAccounts()
    if (newId) setSelId(newId)
  }
  async function delAcc(a) {
    if (!confirm(`Xóa tài khoản "${a.name}"? Mọi giao dịch của tài khoản này cũng bị xóa.`)) return
    const { error } = await supabase.from('bank_accounts').delete().eq('id', a.id)
    if (error) { setErr(error.message); return }
    setSelId(null); loadAccounts()
  }

  // ---- giao dịch tay ----
  async function addTx() {
    setErr('')
    if (!selId) { setErr('Chọn tài khoản trước.'); return }
    if (!txForm.tx_date || !(Number(txForm.amount) > 0)) { setErr('Nhập ngày và số tiền > 0.'); return }
    const t = /^\d{2}:\d{2}(:\d{2})?$/.test(txForm.tx_time) ? txForm.tx_time : '00:00:00'
    const { error } = await supabase.from('bank_tx').insert({
      account_id: selId, tx_date: txForm.tx_date,
      tx_at: `${txForm.tx_date}T${t.length === 5 ? t + ':00' : t}`,
      direction: txForm.direction,
      amount: Number(txForm.amount), description: txForm.description.trim() || null,
      counterparty: txForm.counterparty.trim() || null,
    })
    if (error) { setErr(error.message); return }
    setTxForm({ tx_date: txForm.tx_date, tx_time: '', direction: txForm.direction, amount: '', description: '', counterparty: '' })
    loadTxs(selId)
  }
  async function delTx(t) {
    if (!confirm('Xóa giao dịch này?')) return
    await supabase.from('bank_tx').delete().eq('id', t.id)
    loadTxs(selId)
  }

  // ---- import sao kê ----
  async function onPickStatement(file) {
    setImpErr(''); setImpRows([])
    if (!file) return
    setImpBusy(true)
    try {
      const rows = await readStatementFile(file)
      if (rows.length === 0) setImpErr('Không đọc được giao dịch nào từ file.')
      setImpRows(rows.map((r) => ({ ...r, include: !r.error })))
    } catch (e) {
      setImpErr(e.message)
    } finally {
      setImpBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  function patchImp(i, patch) {
    setImpRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  async function saveImport() {
    if (!selId) { setImpErr('Chọn tài khoản trước.'); return }
    const good = impRows.filter((r) => r.include && !r.error)
    if (good.length === 0) { setImpErr('Không có dòng hợp lệ để ghi.'); return }
    setSavingImp(true)
    const payload = good.map((r) => ({
      account_id: selId, tx_date: r.tx_date,
      tx_at: r.tx_at || `${r.tx_date}T00:00:00`,
      direction: r.direction,
      amount: Number(r.amount), description: r.description || null,
      counterparty: r.counterparty || null,
    }))
    const { error } = await supabase.from('bank_tx').insert(payload)
    setSavingImp(false)
    if (error) { setImpErr(error.message); return }
    setShowImport(false); setImpRows([])
    setOk(`Đã ghi ${good.length} giao dịch từ sao kê.`)
    setTimeout(() => setOk(''), 4000)
    loadTxs(selId)
  }

  if (accounts === null) return <Loading />

  return (
    <div className="full-bleed">
      <div className="page-head">
        <div>
          <h1>Tài khoản ngân hàng</h1>
          <div className="sub">Quản lý nhiều tài khoản, số dư đầu kỳ, giao dịch và số dư cuối. Import sao kê bằng AI.</div>
        </div>
        <button className="btn" onClick={openNewAcc}>+ Thêm tài khoản</button>
      </div>

      <Alert>{err}</Alert>
      {ok && <Alert kind="ok">{ok}</Alert>}

      <div className="bank-layout">
        {/* danh sách tài khoản */}
        <Panel title="Tài khoản">
          {accounts.length === 0 ? (
            <Empty>Chưa có tài khoản. Bấm “Thêm tài khoản”.</Empty>
          ) : (
            <div className="acc-list">
              {accounts.map((a) => (
                <div key={a.id}
                  className={`acc-item ${a.id === selId ? 'active' : ''}`}
                  onClick={() => setSelId(a.id)}>
                  <div className="acc-name">{a.name}</div>
                  <div className="acc-sub">
                    {a.bank || '—'}{a.account_no ? ` · ${a.account_no}` : ''}
                  </div>
                  <div className="acc-open">Đầu kỳ: {vnd(a.opening_balance)}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* chi tiết tài khoản đang chọn */}
        {!selected ? (
          <Panel><Empty>Chọn một tài khoản để xem giao dịch.</Empty></Panel>
        ) : (
          <div>
            <Panel
              title={`${selected.name} — số dư cuối: ${vnd(closingBalance)}`}
              actions={
                <div className="btn-row">
                  <button className="btn ghost sm" onClick={() => setShowImport(true)}>Import sao kê</button>
                  <button className="btn ghost sm" onClick={() => openEditAcc(selected)}>Sửa TK</button>
                  <button className="btn danger sm" onClick={() => delAcc(selected)}>Xóa TK</button>
                </div>
              }
            >
              {/* form thêm giao dịch */}
              <div className="row c4" style={{ alignItems: 'end' }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Ngày giờ</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="date" value={txForm.tx_date}
                      onChange={(e) => setTxForm({ ...txForm, tx_date: e.target.value })} />
                    <input type="time" step="1" value={txForm.tx_time} style={{ width: 110 }}
                      title="Giờ (tùy chọn) — giúp xếp đúng thứ tự trong ngày"
                      onChange={(e) => setTxForm({ ...txForm, tx_time: e.target.value })} />
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Loại</label>
                  <select value={txForm.direction}
                    onChange={(e) => setTxForm({ ...txForm, direction: e.target.value })}>
                    <option value="in">Thu (tiền vào)</option>
                    <option value="out">Chi (tiền ra)</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Số tiền</label>
                  <input type="number" step="any" min="0" value={txForm.amount}
                    onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <button className="btn accent sm" style={{ width: '100%' }} onClick={addTx}>+ Thêm</button>
                </div>
              </div>
              <div className="row c2" style={{ marginTop: 10 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>TK đối ứng (tên)</label>
                  <input value={txForm.counterparty}
                    onChange={(e) => setTxForm({ ...txForm, counterparty: e.target.value })} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Nội dung</label>
                  <input value={txForm.description}
                    onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} />
                </div>
              </div>
            </Panel>

            <Panel title="Giao dịch">
              {txsWithBalance.length === 0 ? (
                <Empty>Chưa có giao dịch. Số dư = số dư đầu kỳ ({vnd(selected.opening_balance)}).</Empty>
              ) : (
                <table className="grid">
                  <thead>
                    <tr>
                      <th style={{ width: 92 }}>Ngày</th>
                      <th style={{ width: 200 }}>TK đối ứng</th>
                      <th>Nội dung</th>
                      <th className="num" style={{ width: 150 }}>Thu</th>
                      <th className="num" style={{ width: 150 }}>Chi</th>
                      <th className="num" style={{ width: 160 }}>Số dư</th>
                      <th style={{ width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={5} className="muted">Số dư đầu kỳ</td>
                      <td className="num" style={{ fontWeight: 600 }}>{vnd(selected.opening_balance)}</td>
                      <td></td>
                    </tr>
                    {txsWithBalance.map((t) => {
                      const hhmm = t.tx_at ? String(t.tx_at).slice(11, 19) : ''
                      return (
                      <tr key={t.id}>
                        <td>{dmy(t.tx_date)}
                          {hhmm && hhmm !== '00:00:00' &&
                            <span className="muted" style={{ fontSize: 11, display: 'block' }}>{hhmm}</span>}
                        </td>
                        <td>{t.counterparty || <span className="muted">—</span>}</td>
                        <td>{t.description || <span className="muted">—</span>}</td>
                        <td className="num pos" style={{ whiteSpace: 'nowrap' }}>{t.direction === 'in' ? vnd(t.amount) : ''}</td>
                        <td className="num neg" style={{ whiteSpace: 'nowrap' }}>{t.direction === 'out' ? vnd(t.amount) : ''}</td>
                        <td className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{vnd(t.balance)}</td>
                        <td><button className="icon-btn del" onClick={() => delTx(t)}>✕</button></td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        )}
      </div>

      {/* Modal thêm/sửa tài khoản */}
      {accModal && (
        <Modal
          title={accModal === 'new' ? 'Thêm tài khoản' : 'Sửa tài khoản'}
          onClose={() => setAccModal(null)}
          footer={<>
            <button className="btn ghost" onClick={() => setAccModal(null)}>Hủy</button>
            <button className="btn accent" onClick={saveAcc}>Lưu</button>
          </>}
        >
          <div className="field">
            <label>Tên gợi nhớ *</label>
            <input placeholder="VD: VCB chính" value={accForm.name}
              onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} />
          </div>
          <div className="row c2">
            <div className="field">
              <label>Ngân hàng</label>
              <input value={accForm.bank}
                onChange={(e) => setAccForm({ ...accForm, bank: e.target.value })} />
            </div>
            <div className="field">
              <label>Số tài khoản</label>
              <input value={accForm.account_no}
                onChange={(e) => setAccForm({ ...accForm, account_no: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Số dư đầu kỳ</label>
            <input type="number" step="any" value={accForm.opening_balance}
              onChange={(e) => setAccForm({ ...accForm, opening_balance: e.target.value })} />
          </div>
          <div className="field">
            <label>Ghi chú</label>
            <input value={accForm.note}
              onChange={(e) => setAccForm({ ...accForm, note: e.target.value })} />
          </div>
        </Modal>
      )}

      {/* Modal import sao kê */}
      {showImport && (
        <Modal
          wide
          title={`Import sao kê — ${selected?.name || ''}`}
          onClose={() => setShowImport(false)}
          footer={<>
            <div style={{ marginRight: 'auto', color: 'var(--ink-soft)', fontSize: 13 }}>
              {impRows.length > 0 && <>Chọn ghi: <b>{impRows.filter((r) => r.include && !r.error).length}</b> / {impRows.length}</>}
            </div>
            <button className="btn ghost" onClick={() => setShowImport(false)}>Đóng</button>
            <button className="btn accent" onClick={saveImport}
              disabled={savingImp || impRows.filter((r) => r.include && !r.error).length === 0}>
              {savingImp ? 'Đang ghi…' : 'Ghi vào tài khoản'}
            </button>
          </>}
        >
          {impErr && <Alert>{impErr}</Alert>}
          <div className="panel" style={{ boxShadow: 'none', background: '#f7f9fb', marginBottom: 14 }}>
            <div className="panel-body" style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="btn" style={{ cursor: impBusy ? 'wait' : 'pointer' }}>
                  {impBusy ? 'AI đang đọc…' : 'Chọn file sao kê (Excel/PDF)'}
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" disabled={impBusy}
                    style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; onPickStatement(f) }} />
                </label>
                <span className="inline-note" style={{ margin: 0 }}>
                  AI đọc mọi định dạng sao kê. Soát lại trước khi ghi.
                </span>
              </div>
            </div>
          </div>

          {impRows.length === 0 ? (
            <Empty>Chưa có dữ liệu. Chọn file sao kê để bắt đầu.</Empty>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th style={{ width: 120 }}>Ngày</th>
                  <th style={{ width: 190 }}>TK đối ứng</th>
                  <th>Nội dung</th>
                  <th style={{ width: 90 }}>Loại</th>
                  <th className="num" style={{ width: 150 }}>Số tiền</th>
                </tr>
              </thead>
              <tbody>
                {impRows.map((r, i) => (
                  <tr key={i} style={r.error ? { background: 'var(--danger-soft)' } : undefined}>
                    <td>
                      <input type="checkbox" checked={r.include} disabled={!!r.error}
                        onChange={(e) => patchImp(i, { include: e.target.checked })} />
                    </td>
                    <td>
                      <input type="date" value={r.tx_date}
                        onChange={(e) => patchImp(i, { tx_date: e.target.value, error: null })} />
                      {r.tx_time && <div className="muted" style={{ fontSize: 11 }}>{r.tx_time}</div>}
                    </td>
                    <td>
                      <input value={r.counterparty || ''}
                        onChange={(e) => patchImp(i, { counterparty: e.target.value })} />
                    </td>
                    <td>
                      <input value={r.description}
                        onChange={(e) => patchImp(i, { description: e.target.value })} />
                      {r.error && <div className="neg" style={{ fontSize: 12 }}>{r.error}</div>}
                    </td>
                    <td>
                      <select value={r.direction}
                        onChange={(e) => patchImp(i, { direction: e.target.value })}>
                        <option value="in">Thu</option>
                        <option value="out">Chi</option>
                      </select>
                    </td>
                    <td>
                      <input type="number" step="any" value={r.amount} style={{ textAlign: 'right' }}
                        onChange={(e) => patchImp(i, { amount: Number(e.target.value), error: Number(e.target.value) > 0 ? null : r.error })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  )
}
