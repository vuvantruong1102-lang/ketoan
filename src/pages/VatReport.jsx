import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Panel, Alert, Loading } from '../components/ui'
import { vnd, recentYears } from '../lib/format'

export default function VatReport() {
  const yNow = new Date().getFullYear()
  const [year, setYear] = useState(yNow)
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1)
  const [vat, setVat] = useState(null)
  const [carryover, setCarryover] = useState(0)
  const [carryInput, setCarryInput] = useState('')
  const [savingCarry, setSavingCarry] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  async function load() {
    setErr(''); setOk('')
    const [vatR, carryR] = await Promise.all([
      supabase.from('v_vat_by_quarter').select('*').eq('year', year).eq('quarter', quarter).maybeSingle(),
      supabase.from('vat_carryover').select('amount').eq('year', year).eq('quarter', quarter).maybeSingle(),
    ])
    if (vatR.error) setErr(vatR.error.message)
    setVat(vatR.data || { output_vat: 0, deductible_input_vat: 0, vat_payable: 0 })
    const c = Number(carryR.data?.amount || 0)
    setCarryover(c)
    setCarryInput(c ? String(c) : '')
  }
  useEffect(() => { load() }, [year, quarter])

  async function saveCarryover() {
    setErr(''); setOk('')
    setSavingCarry(true)
    const amount = Number(carryInput || 0)
    const { error } = await supabase.from('vat_carryover')
      .upsert({ year: Number(year), quarter: Number(quarter), amount }, { onConflict: 'year,quarter' })
    setSavingCarry(false)
    if (error) { setErr(error.message); return }
    setCarryover(amount)
    setOk('Đã lưu số thuế khấu trừ kỳ trước.')
    setTimeout(() => setOk(''), 3000)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Thuế GTGT (VAT)</h1>
          <div className="sub">Thuế GTGT phải nộp theo từng quý.</div>
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
      </div>

      {vat === null ? <Loading /> : (
        <Panel title="Thuế GTGT phải nộp">
          {(() => {
            const payable = Number(vat.output_vat) - Number(vat.deductible_input_vat) - Number(carryover)
            return (
              <table className="grid">
                <tbody>
                  <tr><td>Thuế GTGT đầu ra (bán ra)</td>
                    <td className="num">{vnd(vat.output_vat)}</td></tr>
                  <tr><td>(−) Thuế GTGT đầu vào được khấu trừ</td>
                    <td className="num">{vnd(vat.deductible_input_vat)}</td></tr>
                  <tr><td>(−) Thuế GTGT khấu trừ kỳ trước chuyển sang</td>
                    <td className="num">{vnd(carryover)}</td></tr>
                  <tr style={{ borderTop: '2px solid var(--line-strong)' }}>
                    <td style={{ fontWeight: 700 }}>
                      {payable >= 0 ? 'Thuế phải nộp' : 'Được khấu trừ chuyển kỳ sau'}
                    </td>
                    <td className={`num ${payable > 0 ? 'neg' : 'pos'}`} style={{ fontWeight: 700 }}>
                      {vnd(Math.abs(payable))}</td></tr>
                </tbody>
              </table>
            )
          })()}

          <div className="row c2" style={{ marginTop: 14, alignItems: 'end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Thuế khấu trừ kỳ trước chuyển sang (nhập tay)</label>
              <input type="number" step="any" min="0" value={carryInput} placeholder="0"
                onChange={(e) => setCarryInput(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <button className="btn sm" onClick={saveCarryover} disabled={savingCarry}>
                {savingCarry ? 'Đang lưu…' : 'Lưu số khấu trừ kỳ trước'}
              </button>
            </div>
          </div>
          <div className="inline-note" style={{ marginTop: 8 }}>
            Hóa đơn mua “không được khấu trừ” đã được loại khỏi thuế đầu vào và chuyển sang chi phí.
            Số khấu trừ kỳ trước được lưu riêng cho {year}/Q{quarter}.
          </div>
        </Panel>
      )}
    </>
  )
}
