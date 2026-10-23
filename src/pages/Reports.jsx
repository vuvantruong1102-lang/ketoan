import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Loading, Kpi } from '../components/ui'
import { vnd, num, recentYears } from '../lib/format'

export default function Reports() {
  const yNow = new Date().getFullYear()
  const [year, setYear] = useState(yNow)
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1)
  const [pl, setPl] = useState(null)
  const [vat, setVat] = useState(null)
  const [cogs, setCogs] = useState([])
  const [period, setPeriod] = useState(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setErr(''); setOk('')
    const [plR, vatR, cogsR, perR] = await Promise.all([
      supabase.from('v_pl_by_quarter').select('*').eq('year', year).eq('quarter', quarter).maybeSingle(),
      supabase.from('v_vat_by_quarter').select('*').eq('year', year).eq('quarter', quarter).maybeSingle(),
      supabase.from('cogs_period').select('*, products(sku,name)').eq('year', year).eq('quarter', quarter).order('id'),
      supabase.from('periods').select('*').eq('year', year).eq('quarter', quarter).maybeSingle(),
    ])
    if (plR.error) setErr(plR.error.message)
    setPl(plR.data || { revenue: 0, cogs: 0, expenses: 0, profit: 0 })
    setVat(vatR.data || { output_vat: 0, deductible_input_vat: 0, vat_payable: 0 })
    setCogs(cogsR.data || [])
    setPeriod(perR.data || null)
  }
  useEffect(() => { load() }, [year, quarter])

  async function closePeriod() {
    if (!confirm(
      `Chốt kỳ ${year}/Q${quarter}?\n\n` +
      'Phần mềm sẽ tính giá vốn bình quân gia quyền cuối kỳ cho tất cả sản phẩm ' +
      'và khóa kỳ này. Bạn vẫn xem được số liệu sau khi chốt.'
    )) return
    setBusy(true); setErr(''); setOk('')
    const { error } = await supabase.rpc('close_period', { p_year: Number(year), p_quarter: Number(quarter) })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOk(`Đã chốt kỳ ${year}/Q${quarter}. Giá vốn và lợi nhuận giờ đã chính thức.`)
    load()
  }

  const isClosed = period?.status === 'closed'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Báo cáo</h1>
          <div className="sub">Lợi nhuận, VAT phải nộp và chốt kỳ — theo từng quý.</div>
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
        <div className="field">
          <label>Quý</label>
          <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            <option value="1">Q1</option><option value="2">Q2</option>
            <option value="3">Q3</option><option value="4">Q4</option>
          </select>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          {isClosed ? (
            <span className="badge closed">Đã chốt kỳ</span>
          ) : (
            <button className="btn accent" onClick={closePeriod} disabled={busy}>
              {busy ? 'Đang chốt…' : `Chốt kỳ ${year}/Q${quarter}`}
            </button>
          )}
        </div>
      </div>

      {pl === null ? <Loading /> : (
        <>
          {!isClosed && (
            <div className="alert warn">
              Kỳ chưa chốt — giá vốn và lợi nhuận đang là <b>tạm tính</b>. Giá vốn chỉ
              chính thức sau khi bấm “Chốt kỳ” (tính bình quân gia quyền cuối kỳ).
            </div>
          )}

          <div className="kpis">
            <Kpi label="Doanh thu" value={vnd(pl.revenue)} />
            <Kpi label="Giá vốn hàng bán" value={vnd(pl.cogs)} />
            <Kpi label="Chi phí" value={vnd(pl.expenses)} />
            <Kpi label="Lợi nhuận"
              value={vnd(pl.profit)}
              tone={pl.profit >= 0 ? 'pos' : 'neg'} />
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
                  <td style={{ fontWeight: 700 }}>Lợi nhuận</td>
                  <td className={`num ${pl.profit >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 700 }}>
                    {vnd(pl.profit)}</td></tr>
              </tbody>
            </table>
          </Panel>

          <Panel title="Thuế GTGT phải nộp">
            <table className="grid">
              <tbody>
                <tr><td>Thuế GTGT đầu ra (bán ra)</td>
                  <td className="num">{vnd(vat.output_vat)}</td></tr>
                <tr><td>(−) Thuế GTGT đầu vào được khấu trừ</td>
                  <td className="num">{vnd(vat.deductible_input_vat)}</td></tr>
                <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                  <td style={{ fontWeight: 700 }}>
                    {vat.vat_payable >= 0 ? 'Thuế phải nộp' : 'Được khấu trừ chuyển kỳ sau'}
                  </td>
                  <td className={`num ${vat.vat_payable > 0 ? 'neg' : 'pos'}`} style={{ fontWeight: 700 }}>
                    {vnd(Math.abs(vat.vat_payable))}</td></tr>
              </tbody>
            </table>
            <div className="inline-note">
              Hóa đơn mua “không được khấu trừ” đã được loại khỏi thuế đầu vào và chuyển sang chi phí.
            </div>
          </Panel>

          {isClosed && cogs.length > 0 && (
            <Panel title="Chi tiết giá vốn đã chốt (bình quân gia quyền cuối kỳ)">
              <table className="grid">
                <thead>
                  <tr>
                    <th>SKU</th><th>Tên</th>
                    <th className="num">Tồn đầu</th><th className="num">Mua trong kỳ</th>
                    <th className="num">Đơn giá BQ</th><th className="num">Đã bán</th>
                    <th className="num">Giá vốn</th><th className="num">Tồn cuối</th>
                  </tr>
                </thead>
                <tbody>
                  {cogs.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.products?.sku}</td>
                      <td>{r.products?.name}</td>
                      <td className="num">{num(r.opening_qty)}</td>
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
      )}
    </>
  )
}
