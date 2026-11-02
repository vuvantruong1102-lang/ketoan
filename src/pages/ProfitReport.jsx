import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Loading, Kpi } from '../components/ui'
import { vnd, num, recentYears } from '../lib/format'

export default function ProfitReport() {
  const yNow = new Date().getFullYear()
  const [mode, setMode] = useState('quarter')   // 'quarter' | 'year'
  const [year, setYear] = useState(yNow)
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1)

  // --- dữ liệu quý ---
  const [pl, setPl] = useState(null)
  const [cogs, setCogs] = useState([])
  const [period, setPeriod] = useState(null)
  const [extraExp, setExtraExp] = useState(0)        // tổng chi phí từ panel Chi phí (quý)
  const [extraByCat, setExtraByCat] = useState([])   // chi phí theo loại (quý)

  // --- dữ liệu năm ---
  const [yearData, setYearData] = useState(null)

  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  // khoảng ngày cho năm/quý
  function rangeOf(y, q) {
    if (!q) return [`${y}-01-01`, `${y + 1}-01-01`]
    const m0 = (q - 1) * 3
    const from = `${y}-${String(m0 + 1).padStart(2, '0')}-01`
    const nm = m0 + 3
    const to = nm >= 12 ? `${y + 1}-01-01` : `${y}-${String(nm + 1).padStart(2, '0')}-01`
    return [from, to]
  }

  async function fetchExpenses(y, q) {
    const [from, to] = rangeOf(y, q)
    const { data } = await supabase.from('expenses').select('amount, category')
      .gte('exp_date', from).lt('exp_date', to)
    const list = data || []
    const total = list.reduce((s, r) => s + Number(r.amount), 0)
    const m = new Map()
    for (const r of list) m.set(r.category, (m.get(r.category) || 0) + Number(r.amount))
    return { total, byCat: Array.from(m.entries()).sort((a, b) => b[1] - a[1]) }
  }

  async function loadQuarter() {
    setErr(''); setOk('')
    const [plR, cogsR, perR, exp] = await Promise.all([
      supabase.from('v_pl_by_quarter').select('*').eq('year', year).eq('quarter', quarter).maybeSingle(),
      supabase.from('cogs_period').select('*, products(sku,name)').eq('year', year).eq('quarter', quarter).order('id'),
      supabase.from('periods').select('*').eq('year', year).eq('quarter', quarter).maybeSingle(),
      fetchExpenses(Number(year), Number(quarter)),
    ])
    if (plR.error) setErr(plR.error.message)
    setPl(plR.data || { revenue: 0, cogs: 0, expenses: 0, profit: 0 })
    setCogs(cogsR.data || [])
    setPeriod(perR.data || null)
    setExtraExp(exp.total)
    setExtraByCat(exp.byCat)
  }

  async function loadYear() {
    setErr('')
    setYearData(null)
    const [plR, perR, exp] = await Promise.all([
      supabase.from('v_pl_by_quarter').select('*').eq('year', year),
      supabase.from('periods').select('*').eq('year', year),
      fetchExpenses(Number(year), null),
    ])
    if (plR.error) { setErr(plR.error.message); return }
    const pls = plR.data || []
    const pers = perR.data || []
    const sum = (arr, k) => arr.reduce((s, r) => s + Number(r[k] || 0), 0)
    const revenue = sum(pls, 'revenue')
    const cogsY = sum(pls, 'cogs')
    const invoiceExp = sum(pls, 'expenses')        // chi phí từ hóa đơn đầu vào
    const extra = exp.total                        // chi phí từ panel Chi phí
    const totalExp = invoiceExp + extra
    const profit = revenue - cogsY - totalExp
    const closedQ = new Set(pers.filter((p) => p.status === 'closed').map((p) => p.quarter))
    const unclosed = [1, 2, 3, 4].filter((q) => !closedQ.has(q))
    setYearData({
      revenue, cogs: cogsY, invoiceExp, extra, totalExp, profit, byCat: exp.byCat, unclosed,
    })
  }

  useEffect(() => {
    if (mode === 'quarter') loadQuarter(); else loadYear()
  }, [mode, year, quarter])

  async function closePeriod() {
    if (!confirm(`Chốt kỳ ${year}/Q${quarter}?\n\nPhần mềm tính giá vốn và khóa kỳ này.`)) return
    setBusy(true); setErr(''); setOk('')
    const { error } = await supabase.rpc('close_period', { p_year: Number(year), p_quarter: Number(quarter) })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOk(`Đã chốt kỳ ${year}/Q${quarter}.`)
    loadQuarter()
  }
  async function reopenPeriod() {
    if (!confirm(`Mở lại kỳ ${year}/Q${quarter}? Kết quả giá vốn đã chốt sẽ bị xóa.`)) return
    setBusy(true); setErr(''); setOk('')
    const { error } = await supabase.rpc('reopen_period', { p_year: Number(year), p_quarter: Number(quarter) })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOk(`Đã mở lại kỳ ${year}/Q${quarter}.`)
    loadQuarter()
  }

  const isClosed = period?.status === 'closed'

  // Chi phí hóa đơn đầu vào (pl.expenses) + chi phí từ panel Chi phí (extraExp).
  // Lợi nhuận = doanh thu - giá vốn - (chi phí hóa đơn + chi phí panel).
  const qInvoiceExp = pl ? Number(pl.expenses) : 0
  const qRevenue = pl ? Number(pl.revenue) : 0
  const qCogs = pl ? Number(pl.cogs) : 0
  const qProfit = qRevenue - qCogs - qInvoiceExp - extraExp

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kết quả kinh doanh</h1>
          <div className="sub">Doanh thu, giá vốn, chi phí và lợi nhuận — theo quý hoặc cả năm.</div>
        </div>
        <div className="btn-row">
          <button className={`btn ${mode === 'quarter' ? '' : 'ghost'} sm`} onClick={() => setMode('quarter')}>Theo quý</button>
          <button className={`btn ${mode === 'year' ? '' : 'ghost'} sm`} onClick={() => setMode('year')}>Cả năm</button>
        </div>
      </div>

      <Alert>{err}</Alert>
      {ok && <Alert kind="ok">{ok}</Alert>}

      <div className="toolbar">
        <div className="field">
          <label>Năm</label>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {recentYears().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {mode === 'quarter' && (
          <div className="field">
            <label>Quý</label>
            <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
              <option value="1">Q1</option><option value="2">Q2</option>
              <option value="3">Q3</option><option value="4">Q4</option>
            </select>
          </div>
        )}
        {mode === 'quarter' && (
          <div style={{ marginLeft: 'auto' }}>
            {isClosed ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="badge closed">Đã chốt kỳ</span>
                <button className="btn ghost sm" onClick={reopenPeriod} disabled={busy}>
                  {busy ? 'Đang mở…' : 'Mở lại kỳ'}
                </button>
              </div>
            ) : (
              <button className="btn accent" onClick={closePeriod} disabled={busy}>
                {busy ? 'Đang chốt…' : `Chốt kỳ ${year}/Q${quarter}`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ===================== THEO QUÝ ===================== */}
      {mode === 'quarter' && (pl === null ? <Loading /> : (
        <>
          {!isClosed && (
            <div className="alert warn">
              Kỳ chưa chốt — giá vốn và lợi nhuận đang là <b>tạm tính</b>.
              Giá vốn chỉ chính thức sau khi bấm “Chốt kỳ”.
            </div>
          )}

          <div className="kpis">
            <Kpi label="Doanh thu" value={vnd(qRevenue)} />
            <Kpi label="Giá vốn hàng bán" value={vnd(qCogs)} />
            <Kpi label="Tổng chi phí" value={vnd(qInvoiceExp + extraExp)} />
            <Kpi label="Lợi nhuận" value={vnd(qProfit)} tone={qProfit >= 0 ? 'pos' : 'neg'} />
          </div>

          <Panel title="Kết quả kinh doanh">
            <table className="grid">
              <tbody>
                <tr><td>Doanh thu (chưa thuế)</td>
                  <td className="num" style={{ fontWeight: 600 }}>{vnd(qRevenue)}</td></tr>
                <tr><td>(−) Giá vốn hàng bán {!isClosed && <span className="muted">· chưa chốt</span>}</td>
                  <td className="num">{vnd(qCogs)}</td></tr>
                <tr><td>(−) Chi phí từ hóa đơn đầu vào (dịch vụ mua vào + thuế không khấu trừ)</td>
                  <td className="num">{vnd(qInvoiceExp)}</td></tr>
                {extraByCat.map(([cat, v]) => (
                  <tr key={cat}><td>(−) Chi phí {cat}</td><td className="num">{vnd(v)}</td></tr>
                ))}
                {extraByCat.length === 0 && (
                  <tr><td>(−) Chi phí khác (từ panel Chi phí)</td><td className="num">{vnd(0)}</td></tr>
                )}
                <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                  <td style={{ fontWeight: 700 }}>Lợi nhuận</td>
                  <td className={`num ${qProfit >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 700 }}>
                    {vnd(qProfit)}</td></tr>
              </tbody>
            </table>
            <div className="inline-note" style={{ marginTop: 8 }}>
              Chi phí bán hàng / quản lý được nhập ở trang <b>Chi phí</b> (menu Nghiệp vụ) và tự cộng vào đây.
            </div>
          </Panel>

          {isClosed && cogs.length > 0 && (() => {
            // Kiểm tra giá vốn cho từng SKU:
            //  - thiếu nguồn nhập: có bán nhưng đơn giá BQ = 0
            //  - tồn âm: bán nhiều hơn nhập -> số liệu nhập chưa đủ
            const flag = (r) => {
              if (Number(r.sold_qty) > 0 && Number(r.avg_unit_cost) === 0) return 'Thiếu nguồn nhập (giá vốn = 0)'
              if (Number(r.closing_qty) < 0) return 'Tồn âm (bán nhiều hơn nhập)'
              return null
            }
            const problems = cogs.filter((r) => flag(r)).length
            return (
            <Panel title="Chi tiết giá vốn đã chốt (bình quân gia quyền)">
              {problems > 0 ? (
                <div className="alert warn">
                  <b>{problems}</b> mã hàng có vấn đề về giá vốn (tô đỏ bên dưới). Giá vốn các mã
                  này chưa đúng vì thiếu dữ liệu nhập — hãy nhập <b>tồn kho đầu kỳ (có đơn giá vốn)</b>
                  ở trang Tồn kho, hoặc <b>hóa đơn mua hàng hóa</b> cho các mã đó, rồi <b>Mở lại kỳ → Chốt kỳ</b> lại.
                </div>
              ) : (
                <div className="alert ok">
                  Tất cả mã hàng đã có giá vốn (đơn giá bình quân &gt; 0, không tồn âm).
                  Hãy đối chiếu “Đơn giá BQ” với giá nhập thực tế của bạn để chắc chắn.
                </div>
              )}
              <table className="grid">
                <thead>
                  <tr>
                    <th>SKU</th><th>Tên</th>
                    <th className="num">Tồn đầu</th>
                    <th className="num">Mua lũy kế</th><th className="num">Đơn giá BQ</th>
                    <th className="num">Đã bán</th><th className="num">Giá vốn</th><th className="num">Tồn cuối</th>
                    <th>Kiểm tra</th>
                  </tr>
                </thead>
                <tbody>
                  {cogs.map((r) => {
                    const f = flag(r)
                    return (
                    <tr key={r.id} style={f ? { background: 'var(--danger-soft)' } : undefined}>
                      <td style={{ fontWeight: 600 }}>{r.products?.sku}</td>
                      <td>{r.products?.name}</td>
                      <td className="num">{num(r.opening_qty)}</td>
                      <td className="num">{num(r.purchase_qty)}</td>
                      <td className="num">{vnd(r.avg_unit_cost)}</td>
                      <td className="num">{num(r.sold_qty)}</td>
                      <td className="num">{vnd(r.cogs_value)}</td>
                      <td className="num">{num(r.closing_qty)} · {vnd(r.closing_value)}</td>
                      <td>{f ? <span className="neg" style={{ fontSize: 12 }}>{f}</span>
                             : <span className="pos">✓</span>}</td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </Panel>
          )})()}
        </>
      ))}

      {/* ===================== CẢ NĂM ===================== */}
      {mode === 'year' && (yearData === null ? <Loading /> : (
        <>
          {yearData.unclosed.length > 0 && (
            <div className="alert warn">
              Các quý chưa chốt: <b>{yearData.unclosed.map((q) => 'Q' + q).join(', ')}</b> —
              giá vốn của những quý này đang là 0 nên lợi nhuận cả năm có thể bị thổi phồng.
              Hãy chốt đủ các quý để số liệu năm chính xác.
            </div>
          )}

          <div className="kpis">
            <Kpi label="Doanh thu cả năm" value={vnd(yearData.revenue)} />
            <Kpi label="Giá vốn cả năm" value={vnd(yearData.cogs)} />
            <Kpi label="Tổng chi phí" value={vnd(yearData.totalExp)} />
            <Kpi label="Lợi nhuận" value={vnd(yearData.profit)} tone={yearData.profit >= 0 ? 'pos' : 'neg'} />
          </div>

          <Panel title={`Kết quả kinh doanh năm ${year}`}>
            <table className="grid">
              <tbody>
                <tr><td>Tổng doanh thu (chưa thuế)</td>
                  <td className="num" style={{ fontWeight: 600 }}>{vnd(yearData.revenue)}</td></tr>
                <tr><td>(−) Tổng giá vốn hàng bán</td>
                  <td className="num">{vnd(yearData.cogs)}</td></tr>
                <tr><td>(−) Chi phí từ hóa đơn đầu vào</td>
                  <td className="num">{vnd(yearData.invoiceExp)}</td></tr>
                {yearData.byCat.map(([cat, v]) => (
                  <tr key={cat}><td>(−) Chi phí {cat}</td><td className="num">{vnd(v)}</td></tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                  <td style={{ fontWeight: 700 }}>Lợi nhuận cả năm</td>
                  <td className={`num ${yearData.profit >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 700 }}>
                    {vnd(yearData.profit)}</td></tr>
              </tbody>
            </table>
            <div className="inline-note" style={{ marginTop: 8 }}>
              Số cả năm = cộng gộp 4 quý. Chi phí bán hàng/quản lý lấy từ trang Chi phí.
            </div>
          </Panel>
        </>
      ))}
    </>
  )
}
