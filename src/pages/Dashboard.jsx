import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Panel, Loading, Kpi, Alert } from '../components/ui'
import { vnd } from '../lib/format'

export default function Dashboard() {
  const yNow = new Date().getFullYear()
  const qNow = Math.floor(new Date().getMonth() / 3) + 1
  const [pl, setPl] = useState(null)
  const [vat, setVat] = useState(null)
  const [counts, setCounts] = useState({ partners: 0, products: 0, invoices: 0 })
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      const [plR, vatR, pC, prC, iC] = await Promise.all([
        supabase.from('v_pl_by_quarter').select('*').eq('year', yNow).eq('quarter', qNow).maybeSingle(),
        supabase.from('v_vat_by_quarter').select('*').eq('year', yNow).eq('quarter', qNow).maybeSingle(),
        supabase.from('partners').select('id', { count: 'exact', head: true }),
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('invoices').select('id', { count: 'exact', head: true }),
      ])
      if (plR.error) setErr(plR.error.message)
      setPl(plR.data || { revenue: 0, cogs: 0, expenses: 0, profit: 0 })
      setVat(vatR.data || { vat_payable: 0 })
      setCounts({
        partners: pC.count || 0, products: prC.count || 0, invoices: iC.count || 0,
      })
    })()
  }, [])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tổng quan</h1>
          <div className="sub">Số liệu quý hiện tại — {yNow}/Q{qNow} (tạm tính nếu chưa chốt kỳ)</div>
        </div>
      </div>

      <Alert>{err}</Alert>

      {pl === null ? <Loading /> : (
        <>
          <div className="kpis">
            <Kpi label="Doanh thu quý này" value={vnd(pl.revenue)} />
            <Kpi label="Lợi nhuận tạm tính" value={vnd(pl.profit)}
              tone={pl.profit >= 0 ? 'pos' : 'neg'} />
            <Kpi label={vat.vat_payable >= 0 ? 'VAT phải nộp' : 'VAT khấu trừ chuyển kỳ'}
              value={vnd(Math.abs(vat.vat_payable))}
              tone={vat.vat_payable > 0 ? 'neg' : 'pos'} />
            <Kpi label="Số hóa đơn đã nhập" value={counts.invoices} />
          </div>

          <Panel title="Bắt đầu nhanh">
            <p className="muted" style={{ marginTop: 0 }}>
              Trình tự dùng khuyến nghị cho một quý mới:
            </p>
            <ol style={{ lineHeight: 1.9, paddingLeft: 20 }}>
              <li>Khai báo <Link to="/partners">đối tác</Link> và <Link to="/products">sản phẩm</Link> (chỉ làm một lần, bổ sung dần).</li>
              <li>Nhập <Link to="/inventory">tồn kho đầu kỳ</Link> cho quý (nhập tay hoặc import Excel).</li>
              <li>Nhập <Link to="/invoices">hóa đơn</Link> mua vào và bán ra phát sinh trong quý.</li>
              <li>Ghi <Link to="/cashbank">giao dịch tiền mặt / ngân hàng</Link> để theo dõi số dư.</li>
              <li>Cuối quý, vào <Link to="/reports">Báo cáo</Link> bấm “Chốt kỳ” để tính giá vốn và lợi nhuận chính thức.</li>
            </ol>
          </Panel>

          <Panel title="Danh mục hiện có">
            <div className="kpis" style={{ marginBottom: 0 }}>
              <Kpi label="Đối tác" value={counts.partners} />
              <Kpi label="Sản phẩm" value={counts.products} />
              <Kpi label="Hóa đơn" value={counts.invoices} />
              <Kpi label="Chế độ kế toán" value="TT133" />
            </div>
          </Panel>
        </>
      )}
    </>
  )
}
