-- =====================================================================
-- SỬA LỖI CHỐT KỲ: null value in column "opening_qty" ...
-- Nguyên nhân: sản phẩm KHÔNG có dòng tồn đầu kỳ -> lateral trả 0 dòng
-- -> o.qty / o.val thành NULL. Bọc coalesce(...,0) để luôn ra số.
-- Chạy trong Supabase > SQL Editor. An toàn chạy nhiều lần.
-- =====================================================================

set search_path = ketoan, public;

create or replace function close_period(p_year int, p_quarter int)
returns void language plpgsql
set search_path = ketoan, public as $$
declare
  m_start date := make_date(p_year, (p_quarter-1)*3 + 1, 1);
  m_end   date := (make_date(p_year, (p_quarter-1)*3 + 1, 1) + interval '3 months')::date;
begin
  if exists (select 1 from periods
             where year=p_year and quarter=p_quarter and status='closed') then
    raise exception 'Kỳ %/Q% đã được chốt.', p_year, p_quarter;
  end if;

  delete from cogs_period where year=p_year and quarter=p_quarter;

  insert into cogs_period(
    product_id, year, quarter,
    opening_qty, opening_value, purchase_qty, purchase_value,
    avg_unit_cost, sold_qty, cogs_value, closing_qty, closing_value)
  select
    p.id, p_year, p_quarter,
    coalesce(o.qty,0), coalesce(o.val,0),
    coalesce(pu.qty,0), coalesce(pu.val,0),
    case when (coalesce(o.qty,0) + coalesce(pu.qty,0)) > 0
         then round((coalesce(o.val,0) + coalesce(pu.val,0))
                    / (coalesce(o.qty,0) + coalesce(pu.qty,0)), 4) else 0 end,
    coalesce(sa.qty,0),
    round(coalesce(sa.qty,0) * case when (coalesce(o.qty,0)+coalesce(pu.qty,0))>0
         then (coalesce(o.val,0)+coalesce(pu.val,0))
              /(coalesce(o.qty,0)+coalesce(pu.qty,0)) else 0 end, 2),
    (coalesce(o.qty,0) + coalesce(pu.qty,0) - coalesce(sa.qty,0)),
    round((coalesce(o.qty,0) + coalesce(pu.qty,0) - coalesce(sa.qty,0))
          * case when (coalesce(o.qty,0)+coalesce(pu.qty,0))>0
         then (coalesce(o.val,0)+coalesce(pu.val,0))
              /(coalesce(o.qty,0)+coalesce(pu.qty,0)) else 0 end, 2)
  from products p
  left join lateral (
    select quantity qty, quantity*unit_cost val
    from inventory_opening
    where product_id=p.id and year=p_year and quarter=p_quarter
  ) o on true
  left join lateral (
    select coalesce(sum(ii.quantity),0) qty,
           coalesce(sum(ii.line_before_tax),0) val
    from invoice_items ii join invoices i on i.id=ii.invoice_id
    where ii.product_id=p.id and i.direction='in'
      and i.invoice_date >= m_start and i.invoice_date < m_end
  ) pu on true
  left join lateral (
    select coalesce(sum(ii.quantity),0) qty
    from invoice_items ii join invoices i on i.id=ii.invoice_id
    where ii.product_id=p.id and i.direction='out'
      and i.invoice_date >= m_start and i.invoice_date < m_end
  ) sa on true
  where p.kind='goods';

  insert into periods(year, quarter, status, closed_at)
  values (p_year, p_quarter, 'closed', now())
  on conflict (year, quarter)
  do update set status='closed', closed_at=now();
end $$;

-- =====================================================================
-- Xong. Chốt kỳ lại sẽ không còn lỗi null opening_qty.
-- =====================================================================
