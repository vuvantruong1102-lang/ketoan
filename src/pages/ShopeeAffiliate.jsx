import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Empty, Loading } from '../components/ui'
import { vnd, dmy } from '../lib/format'

const today = () => new Date().toISOString().slice(0, 10)

export default function ShopeeAffiliate() {
  const [rows, setRows] = useState(null)        // bảng 1: hoa hồng hàng ngày
  const [recs, setRecs] = useState(null)        // bảng 3: đối soát
  const [err, setErr] = useState('')
  const [expanded, setExpanded] = useState(null) // mã thanh toán đang mở chi tiết
  // tìm tổng hoa hồng theo khoảng ngày (panel 2)
  const [searchRange, setSearchRange] = useState({ from: '', to: '' })

  // form bảng 1
  const [f1, setF1] = useState({ tx_date: today(), amount: '', payment_code: '' })
  // form bảng 3
  const [f3, setF3] = useState({
    reconcile_date: today(), period_from: '', period_to: '', shopee_amount: '',
  })

  async function load() {
    setErr('')
    const [{ data: a, error: e1 }, { data: r, error: e2 }] = await Promise.all([
      supabase.from('shopee_affiliate').select('*')
        .order('tx_date', { ascending: false }).order('id', { ascending: false }),
      supabase.from('shopee_reconcile').select('*')
        .order('reconcile_date', { ascending: false }).order('id', { ascending: false }),
    ])
    if (e1 || e2) setErr((e1 || e2).message)
    setRows(a || [])
    setRecs(r || [])
  }
  useEffect(() => { load() }, [])

  // ---- Bảng 1: thêm hoa hồng ngày ----
  async function addDaily() {
    setErr('')
    if (!f1.tx_date || !(Number(f1.amount) >= 0) || f1.amount === '') {
      setErr('Nhập ngày và số tiền hợp lệ.'); return
    }
    const { error } = await supabase.from('shopee_affiliate').insert({
      tx_date: f1.tx_date,
      amount: Number(f1.amount),
      payment_code: f1.payment_code.trim() || null,
    })
    if (error) { setErr(error.message); return }
    setF1({ tx_date: f1.tx_date, amount: '', payment_code: f1.payment_code }) // giữ ngày + mã cho nhập liên tục
    load()
  }
  async function delDaily(r) {
    if (!confirm(`Xóa hoa hồng ngày ${dmy(r.tx_date)}?`)) return
    await supabase.from('shopee_affiliate').delete().eq('id', r.id)
    load()
  }

  // ---- Bảng 2: gom theo mã thanh toán ----
  const grouped = useMemo(() => {
    const map = new Map()
    for (const r of rows || []) {
      const key = r.payment_code || '(chưa có mã)'
      if (!map.has(key)) map.set(key, { code: key, total: 0, items: [] })
      const g = map.get(key)
      g.total += Number(r.amount)
      g.items.push(r)
    }
    // sắp theo ngày sớm nhất của mã
    return Array.from(map.values()).sort((a, b) => {
      const da = Math.min(...a.items.map((x) => +new Date(x.tx_date)))
      const db = Math.min(...b.items.map((x) => +new Date(x.tx_date)))
      return db - da
    })
  }, [rows])

  // tổng hoa hồng từ đầu đến nay
  const grandTotal = useMemo(
    () => (rows || []).reduce((s, r) => s + Number(r.amount), 0), [rows])

  // ---- Bảng 3: đối soát ----
  function sumInRange(from, to) {
    if (!from || !to) return 0
    return (rows || []).reduce((s, r) =>
      (r.tx_date >= from && r.tx_date <= to) ? s + Number(r.amount) : s, 0)
  }
  // tổng hoa hồng theo khoảng tìm kiếm ở panel 2
  const searchTotal = sumInRange(searchRange.from, searchRange.to)
  // tổng tự nhập theo khoảng đang nhập ở form (xem trước)
  const f3MyTotal = sumInRange(f3.period_from, f3.period_to)
  const f3Diff = f3MyTotal - Number(f3.shopee_amount || 0)

  async function addReconcile() {
    setErr('')
    if (!f3.period_from || !f3.period_to) { setErr('Chọn khoảng thời gian đối soát.'); return }
    if (f3.period_to < f3.period_from) { setErr('“Đến ngày” phải sau “Từ ngày”.'); return }
    if (f3.shopee_amount === '') { setErr('Nhập số tiền Shopee đối soát.'); return }
    const { error } = await supabase.from('shopee_reconcile').insert({
      reconcile_date: f3.reconcile_date,
      period_from: f3.period_from,
      period_to: f3.period_to,
      shopee_amount: Number(f3.shopee_amount),
    })
    if (error) { setErr(error.message); return }
    setF3({ reconcile_date: today(), period_from: '', period_to: '', shopee_amount: '' })
    load()
  }
  async function delReconcile(r) {
    if (!confirm('Xóa dòng đối soát này?')) return
    await supabase.from('shopee_reconcile').delete().eq('id', r.id)
    load()
  }

  const loading = rows === null || recs === null

  return (
    <div className="full-bleed">
      <div className="page-head">
        <div>
          <h1>Đối soát Shopee Affiliate</h1>
          <div className="sub">Theo dõi hoa hồng affiliate hàng ngày và đối soát với số Shopee chi trả. Panel độc lập.</div>
        </div>
      </div>

      <Alert>{err}</Alert>

      {loading ? <Loading /> : (
        <div className="shopee-cols">
          {/* ---------- BẢNG 1 ---------- */}
          <Panel title="1 · Hoa hồng hàng ngày">
            <div className="field">
              <label>Ngày</label>
              <input type="date" value={f1.tx_date}
                onChange={(e) => setF1({ ...f1, tx_date: e.target.value })} />
            </div>
            <div className="field">
              <label>Số tiền hoa hồng</label>
              <input type="number" step="any" min="0" value={f1.amount}
                onChange={(e) => setF1({ ...f1, amount: e.target.value })} />
            </div>
            <div className="field">
              <label>Mã thanh toán</label>
              <input placeholder="VD: PAY0001" value={f1.payment_code}
                onChange={(e) => setF1({ ...f1, payment_code: e.target.value })} />
            </div>
            <button className="btn accent sm" style={{ width: '100%' }} onClick={addDaily}>
              + Thêm ngày
            </button>

            <table className="grid" style={{ marginTop: 14 }}>
              <thead>
                <tr><th>Ngày</th><th className="num">Số tiền</th><th>Mã</th><th style={{ width: 28 }}></th></tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={4}><Empty>Chưa có dữ liệu.</Empty></td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id}>
                    <td>{dmy(r.tx_date)}</td>
                    <td className="num">{vnd(r.amount)}</td>
                    <td>{r.payment_code || <span className="muted">—</span>}</td>
                    <td><button className="icon-btn del" onClick={() => delDaily(r)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {/* ---------- BẢNG 2 ---------- */}
          <Panel title="2 · Gom theo mã thanh toán">
            {/* tổng hoa hồng từ đầu đến nay */}
            <div className="alert" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              Tổng hoa hồng đã nhận (từ đầu): <b>{vnd(grandTotal)}</b>
            </div>

            {/* tìm tổng hoa hồng theo khoảng ngày */}
            <div className="row c2" style={{ marginBottom: 8 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Từ ngày</label>
                <input type="date" value={searchRange.from}
                  onChange={(e) => setSearchRange({ ...searchRange, from: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Đến ngày</label>
                <input type="date" value={searchRange.to}
                  onChange={(e) => setSearchRange({ ...searchRange, to: e.target.value })} />
              </div>
            </div>
            {searchRange.from && searchRange.to && (
              <div className="alert" style={{ background: '#f7f9fb', color: 'var(--ink)', fontSize: 13 }}>
                Tổng hoa hồng trong khoảng: <b>{vnd(searchTotal)}</b>
              </div>
            )}

            {grouped.length === 0 ? <Empty>Chưa có dữ liệu.</Empty> : (
              <table className="grid">
                <thead>
                  <tr><th>Mã thanh toán</th><th className="num">Tổng hoa hồng</th></tr>
                </thead>
                <tbody>
                  {grouped.map((g) => (
                    <Fragment key={g.code}>
                      <tr style={{ cursor: 'pointer' }}
                        onClick={() => setExpanded(expanded === g.code ? null : g.code)}>
                        <td style={{ fontWeight: 500 }}>
                          <span style={{ display: 'inline-block', width: 14 }}>
                            {expanded === g.code ? '▾' : '▸'}
                          </span>
                          {g.code}
                          <span className="muted" style={{ fontSize: 12 }}> · {g.items.length} ngày</span>
                        </td>
                        <td className="num" style={{ fontWeight: 600 }}>{vnd(g.total)}</td>
                      </tr>
                      {expanded === g.code && g.items
                        .slice().sort((a, b) => a.tx_date.localeCompare(b.tx_date))
                        .map((it) => (
                          <tr key={'d' + it.id} style={{ background: '#f9fbfc' }}>
                            <td style={{ paddingLeft: 28 }} className="muted">{dmy(it.tx_date)}</td>
                            <td className="num muted">{vnd(it.amount)}</td>
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {/* ---------- BẢNG 3 ---------- */}
          <Panel title="3 · Đối soát với Shopee">
            <div className="field">
              <label>Ngày đối soát</label>
              <input type="date" value={f3.reconcile_date}
                onChange={(e) => setF3({ ...f3, reconcile_date: e.target.value })} />
            </div>
            <div className="row c2">
              <div className="field">
                <label>Từ ngày</label>
                <input type="date" value={f3.period_from}
                  onChange={(e) => setF3({ ...f3, period_from: e.target.value })} />
              </div>
              <div className="field">
                <label>Đến ngày</label>
                <input type="date" value={f3.period_to}
                  onChange={(e) => setF3({ ...f3, period_to: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>Số tiền Shopee đối soát</label>
              <input type="number" step="any" value={f3.shopee_amount}
                onChange={(e) => setF3({ ...f3, shopee_amount: e.target.value })} />
            </div>

            {/* xem trước chênh lệch trước khi lưu */}
            {f3.period_from && f3.period_to && (
              <div className="alert" style={{
                background: '#f7f9fb', color: 'var(--ink)', fontSize: 13,
              }}>
                Tổng bạn đã nhập trong khoảng: <b>{vnd(f3MyTotal)}</b><br />
                Chênh lệch: <b className={f3Diff === 0 ? 'pos' : 'neg'}>
                  {f3Diff > 0 ? '+' : ''}{vnd(f3Diff)}
                </b>
                {f3Diff !== 0 && <span className="muted"> (dương = bạn nhập nhiều hơn Shopee)</span>}
              </div>
            )}

            <button className="btn accent sm" style={{ width: '100%' }} onClick={addReconcile}>
              + Lưu đối soát
            </button>

            <table className="grid" style={{ marginTop: 14 }}>
              <thead>
                <tr>
                  <th>Ngày ĐS</th><th>Khoảng</th>
                  <th className="num">Hoa hồng</th>
                  <th className="num">Shopee TT</th>
                  <th className="num">Chênh</th>
                  <th style={{ width: 28 }}></th>
                </tr>
              </thead>
              <tbody>
                {recs.length === 0 ? (
                  <tr><td colSpan={6}><Empty>Chưa có đối soát.</Empty></td></tr>
                ) : recs.map((r) => {
                  const my = sumInRange(r.period_from, r.period_to)  // hoa hồng theo khoảng
                  const diff = my - Number(r.shopee_amount)
                  return (
                    <tr key={r.id}>
                      <td>{dmy(r.reconcile_date)}</td>
                      <td style={{ fontSize: 12 }}>{dmy(r.period_from)}<br />→ {dmy(r.period_to)}</td>
                      <td className="num">{vnd(my)}</td>
                      <td className="num">{vnd(r.shopee_amount)}</td>
                      <td className="num">
                        <span className={diff === 0 ? 'pos' : 'neg'}>
                          {diff > 0 ? '+' : ''}{vnd(diff)}
                        </span>
                      </td>
                      <td><button className="icon-btn del" onClick={() => delReconcile(r)}>✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
    </div>
  )
}
