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
  const [adj, setAdj] = useState({ salary: 0, other_expense: 0 })   // đã lưu
  const [salaryInput, setSalaryInput] = useState('')
  const [otherInput, setOtherInput] = useState('')
  const [savingAdj, setSavingAdj] = useState(false)

  // --- dữ liệu năm ---
  const [yearData, setYearData] = useState(null)

  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadQuarter() {
    setErr(''); setOk('')
    const [plR, cogsR, perR, adjR] = await Promise.all([
      supabase.from('v_pl_by_quarter').select('*').eq('year', year).eq('quarter', quarter).maybeSingle(),
      supabase.from('cogs_period').select('*, products(sku,name)').eq('year', year).eq('quarter', quarter).order('id'),
      supabase.from('periods').select('*').eq('year', year).eq('quarter', quarter).maybeSingle(),
      supabase.from('pl_adjustments').select('*').eq('year', year).eq('quarter', quarter).maybeSingle(),
    ])
    if (plR.error) setErr(plR.error.message)
    setPl(plR.data || { revenue: 0, cogs: 0, expenses: 0, profit: 0 })
    setCogs(cogsR.data || [])
    setPeriod(perR.data || null)
    const a = { salary: Number(adjR.data?.salary || 0), other_expense: Number(adjR.data?.other_expense || 0) }
    setAdj(a)
    setSalaryInput(a.salary ? String(a.salary) : '')
    setOtherInput(a.other_expense ? String(a.other_expense) : '')
  }

  async function loadYear() {
    setErr('')
    setYearData(null)
    const [plR, perR, adjR] = await Promise.all([
      supabase.from('v_pl_by_quarter').select('*').eq('year', year),
      supabase.from('periods').select('*').eq('year', year),
      supabase.from('pl_adjustments').select('*').eq('year', year),
    ])
    if (plR.error) { setErr(plR.error.message); return }
    const pls = plR.data || []
    const pers = perR.data || []
    const adjs = adjR.data || []
    const sum = (arr, k) => arr.reduce((s, r) => s + Number(r[k] || 0), 0)
    const salary = sum(adjs, 'salary')
    const other = sum(adjs, 'other_expense')
    const revenue = sum(pls, 'revenue')
    const cogsY = sum(pls, 'cogs')
    const expenses = sum(pls, 'expenses')
    const profit = revenue - cogsY - expenses
    // quý nào chưa chốt (để cảnh báo giá vốn thiếu)
    const closedQ = new Set(pers.filter((p) => p.status === 'closed').map((p) => p.quarter))
    const unclosed = [1, 2, 3, 4].filter((q) => !closedQ.has(q))
    setYearData({
      revenue, cogs: cogsY, expenses, profit,
      salary, other, taxable: profit - salary - other,
      unclosed,
    })
  }

  useEffect(() => {
    if (mode === 'quarter') loadQuarter(); else loadYear()
  }, [mode, year, quarter])

  async function saveAdj() {
    setErr(''); setOk('')
    setSavingAdj(true)
    const { error } = await supabase.from('pl_adjustments').upsert({
      year: Number(year), quarter: Number(quarter),
      salary: Number(salaryInput || 0), other_expense: Number(otherInput || 0),
    }, { onConflict: 'year,quarter' })
    setSavingAdj(false)
    if (error) { setErr(error.message); return }
    setAdj({ salary: Number(salaryInput || 0), other_expense: Number(otherInput || 0) })
    setOk('Đã lưu lương và chi phí khác.')
    setTimeout(() => setOk(''), 3000)
  }

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

  // lợi nhuận chịu thuế quý
  const qSalary = adj.salary, qOther = adj.other_expense
  const qTaxable = pl ? (Number(pl.profit) - qSalary - qOther) : 0

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
            <Kpi label="Doanh thu" value={vnd(pl.revenue)} />
            <Kpi label="Giá vốn hàng bán" value={vnd(pl.cogs)} />
            <Kpi label="Lợi nhuận" value={vnd(pl.profit)} tone={pl.profit >= 0 ? 'pos' : 'neg'} />
            <Kpi label="Lợi nhuận chịu thuế" value={vnd(qTaxable)} tone={qTaxable >= 0 ? 'pos' : 'neg'} />
          </div>

          <Panel title="Kết quả kinh doanh">
            <table className="grid">
              <tbody>
                <tr><td>Doanh thu (chưa thuế)</td>
                  <td className="num" style={{ fontWeight: 600 }}>{vnd(pl.revenue)}</td></tr>
                <tr><td>(−) Giá vốn hàng bán {!isClosed && <span className="muted">· chưa chốt</span>}</td>
                  <td className="num">{vnd(pl.cogs)}</td></tr>
                <tr><td>(−) Chi phí (dịch vụ mua vào + thuế không được khấu trừ)</td>
                  <td className="num">{vnd(pl.expenses)}</td></tr>
                <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                  <td style={{ fontWeight: 600 }}>Lợi nhuận</td>
                  <td className={`num ${pl.profit >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 600 }}>
                    {vnd(pl.profit)}</td></tr>
                <tr><td>(−) Lương</td><td className="num">{vnd(qSalary)}</td></tr>
                <tr><td>(−) Chi phí khác</td><td className="num">{vnd(qOther)}</td></tr>
                <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                  <td style={{ fontWeight: 700 }}>Lợi nhuận chịu thuế</td>
                  <td className={`num ${qTaxable >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 700 }}>
                    {vnd(qTaxable)}</td></tr>
              </tbody>
            </table>

            <div className="row c3" style={{ marginTop: 14, alignItems: 'end' }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Lương (nhập tay)</label>
                <input type="number" step="any" min="0" value={salaryInput} placeholder="0"
                  onChange={(e) => setSalaryInput(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Chi phí khác (nhập tay)</label>
                <input type="number" step="any" min="0" value={otherInput} placeholder="0"
                  onChange={(e) => setOtherInput(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <button className="btn sm" onClick={saveAdj} disabled={savingAdj}>
                  {savingAdj ? 'Đang lưu…' : 'Lưu lương & chi phí khác'}
                </button>
              </div>
            </div>
            <div className="inline-note" style={{ marginTop: 8 }}>
              Lương và chi phí khác được lưu riêng cho {year}/Q{quarter}.
            </div>
          </Panel>

          {isClosed && cogs.length > 0 && (
            <Panel title="Chi tiết giá vốn đã chốt (bình quân gia quyền)">
              <table className="grid">
                <thead>
                  <tr>
                    <th>SKU</th><th>Tên</th>
                    <th className="num">Mua lũy kế</th><th className="num">Đơn giá BQ</th>
                    <th className="num">Đã bán</th><th className="num">Giá vốn</th><th className="num">Tồn cuối</th>
                  </tr>
                </thead>
                <tbody>
                  {cogs.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.products?.sku}</td>
                      <td>{r.products?.name}</td>
                      <td className="num">{num(r.purchase_qty)}</td>
                      <td className="num">{vnd(r.avg_unit_cost)}</td>
                      <td className="num">{num(r.sold_qty)}</td>
                      <td className="num">{vnd(r.cogs_value)}</td>
                      <td className="num">{num(r.closing_qty)} · {vnd(r.closing_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
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
            <Kpi label="Lợi nhuận" value={vnd(yearData.profit)} tone={yearData.profit >= 0 ? 'pos' : 'neg'} />
            <Kpi label="Lợi nhuận chịu thuế" value={vnd(yearData.taxable)} tone={yearData.taxable >= 0 ? 'pos' : 'neg'} />
          </div>

          <Panel title={`Kết quả kinh doanh năm ${year}`}>
            <table className="grid">
              <tbody>
                <tr><td>Tổng doanh thu (chưa thuế)</td>
                  <td className="num" style={{ fontWeight: 600 }}>{vnd(yearData.revenue)}</td></tr>
                <tr><td>(−) Tổng giá vốn hàng bán</td>
                  <td className="num">{vnd(yearData.cogs)}</td></tr>
                <tr><td>(−) Tổng chi phí</td>
                  <td className="num">{vnd(yearData.expenses)}</td></tr>
                <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                  <td style={{ fontWeight: 600 }}>Lợi nhuận</td>
                  <td className={`num ${yearData.profit >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 600 }}>
                    {vnd(yearData.profit)}</td></tr>
                <tr><td>(−) Tổng lương</td><td className="num">{vnd(yearData.salary)}</td></tr>
                <tr><td>(−) Tổng chi phí khác</td><td className="num">{vnd(yearData.other)}</td></tr>
                <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                  <td style={{ fontWeight: 700 }}>Lợi nhuận chịu thuế cả năm</td>
                  <td className={`num ${yearData.taxable >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 700 }}>
                    {vnd(yearData.taxable)}</td></tr>
              </tbody>
            </table>
            <div className="inline-note" style={{ marginTop: 8 }}>
              Số cả năm = cộng gộp 4 quý. Lương, chi phí khác lấy từ số đã lưu ở từng quý.
            </div>
          </Panel>
        </>
      ))}
    </>
  )
}
