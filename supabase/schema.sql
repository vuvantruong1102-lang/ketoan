-- =====================================================================
-- PHẦN MỀM KẾ TOÁN NỘI BỘ YOKOOL — GIAI ĐOẠN 1
-- Chế độ: Thông tư 133/2016. Mô hình đơn giản hóa (không bút toán kép).
-- Nền tảng: Supabase (PostgreSQL)
-- Cách dùng: dán toàn bộ file này vào Supabase > SQL Editor > Run
-- Tiền tệ: VND. Nội bộ lưu numeric (giữ số lẻ cho giá vốn bình quân);
--          làm tròn về số nguyên đồng khi hiển thị ở tầng app.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. SCHEMA RIÊNG CHO APP KẾ TOÁN
--    App này dùng CHUNG project Supabase với nhiều app khác, nên TẤT CẢ
--    bảng nằm trong schema riêng "ketoan" — KHÔNG đụng schema public của
--    các app kia. Muốn gỡ sạch app kế toán sau này chỉ cần:
--        drop schema ketoan cascade;
--    (chỉ xóa đúng app kế toán, không ảnh hưởng app khác).
-- ---------------------------------------------------------------------
-- CẢNH BÁO: dòng dưới xóa và tạo lại schema ketoan (chỉ app kế toán).
-- An toàn với app khác. Khi đã có dữ liệu thật, BỎ dòng drop đi.
drop schema if exists ketoan cascade;
create schema ketoan;

-- Mọi lệnh bên dưới chạy trong schema ketoan nhờ search_path này.
set search_path = ketoan, public;

-- ---------------------------------------------------------------------
-- 1. KỲ KẾ TOÁN (theo quý)
-- ---------------------------------------------------------------------
create table periods (
  id          bigint generated always as identity primary key,
  year        int  not null,
  quarter     int  not null check (quarter between 1 and 4),
  status      text not null default 'open' check (status in ('open','closed')),
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (year, quarter)
);
comment on table periods is 'Các quý kế toán. status=closed sau khi bấm "Chốt kỳ".';

-- Hàm tiện ích: từ một ngày suy ra (year, quarter)
create or replace function period_of(d date)
returns table(year int, quarter int)
language sql immutable
set search_path = ketoan, public as $$
  select extract(year from d)::int,
         ((extract(month from d)::int - 1) / 3 + 1)::int;
$$;

-- ---------------------------------------------------------------------
-- 2. DANH MỤC ĐỐI TÁC (nhà cung cấp + khách hàng, dùng chung)
-- ---------------------------------------------------------------------
create table partners (
  id          bigint generated always as identity primary key,
  code        text unique,                       -- mã nội bộ, tùy chọn
  name        text not null,
  tax_code    text,                              -- MST
  address     text,
  phone       text,
  -- một đối tác có thể vừa là NCC vừa là khách; đánh dấu để lọc nhanh
  is_supplier boolean not null default false,
  is_customer boolean not null default false,
  note        text,
  created_at  timestamptz not null default now()
);
comment on table partners is 'Nhà cung cấp và khách hàng. Dùng chung một bảng.';
create index idx_partners_name on partners (name);
create index idx_partners_tax  on partners (tax_code);

-- ---------------------------------------------------------------------
-- 3. DANH MỤC SẢN PHẨM (theo SKU)
-- ---------------------------------------------------------------------
create table products (
  id          bigint generated always as identity primary key,
  sku         text not null unique,              -- mã SKU
  name        text not null,
  unit        text,                              -- đơn vị tính (cái, hộp...)
  -- hàng hóa: có tồn kho + giá vốn; dịch vụ: chỉ chi phí/doanh thu, không tồn
  kind        text not null default 'goods' check (kind in ('goods','service')),
  note        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table products is 'Sản phẩm theo SKU. kind=goods có tồn kho, service thì không.';
create index idx_products_name on products (name);

-- ---------------------------------------------------------------------
-- 4. HÓA ĐƠN (đầu vào / đầu ra)
-- ---------------------------------------------------------------------
create table invoices (
  id            bigint generated always as identity primary key,
  -- 'in' = hóa đơn mua vào; 'out' = hóa đơn bán ra
  direction     text not null check (direction in ('in','out')),
  invoice_no    text,                            -- số hóa đơn
  invoice_date  date not null,
  partner_id    bigint references partners(id),
  -- phân loại nội dung chính của hóa đơn
  category      text not null default 'goods' check (category in ('goods','service')),
  -- CHỈ áp dụng cho hóa đơn mua (direction='in'):
  -- true  = đủ điều kiện khấu trừ -> thuế vào "thuế đầu vào được khấu trừ"
  -- false = không đủ điều kiện    -> thuế gộp vào chi phí/giá trị hàng
  vat_deductible boolean not null default true,
  description   text,
  -- tổng tiền được tính lại từ invoice_items bằng trigger (không nhập tay)
  amount_before_tax numeric(18,2) not null default 0,  -- tổng tiền chưa thuế
  tax_amount        numeric(18,2) not null default 0,  -- tổng tiền thuế
  amount_total      numeric(18,2) not null default 0,  -- tổng thanh toán
  created_at    timestamptz not null default now()
);
comment on table invoices is 'Đầu hóa đơn. Tổng tiền tự tính từ invoice_items.';
comment on column invoices.vat_deductible is
  'Chỉ dùng cho hóa đơn mua. false=thuế không được khấu trừ, gộp vào chi phí.';
create index idx_invoices_date      on invoices (invoice_date);
create index idx_invoices_direction on invoices (direction);
create index idx_invoices_partner   on invoices (partner_id);

-- ---------------------------------------------------------------------
-- 5. CHI TIẾT DÒNG HÓA ĐƠN
-- ---------------------------------------------------------------------
create table invoice_items (
  id            bigint generated always as identity primary key,
  invoice_id    bigint not null references invoices(id) on delete cascade,
  product_id    bigint references products(id),
  description   text,                            -- diễn giải (dịch vụ có thể không có SKU)
  quantity      numeric(18,4) not null default 1 check (quantity >= 0),
  unit_price    numeric(18,4) not null default 0 check (unit_price >= 0),  -- đơn giá chưa thuế
  vat_rate      numeric(5,2)  not null default 8 check (vat_rate in (0,5,8,10)),
  -- các cột dưới tự tính bằng trigger
  line_before_tax numeric(18,2) not null default 0,  -- quantity * unit_price
  line_tax        numeric(18,2) not null default 0,  -- line_before_tax * vat_rate/100
  line_total      numeric(18,2) not null default 0,  -- before + tax
  created_at    timestamptz not null default now()
);
comment on table invoice_items is 'Dòng chi tiết hóa đơn. Thành tiền + thuế tự tính.';
create index idx_items_invoice on invoice_items (invoice_id);
create index idx_items_product on invoice_items (product_id);

-- ---------------------------------------------------------------------
-- 6. TỒN KHO ĐẦU KỲ (import Excel). Mỗi SKU 1 dòng cho 1 quý mốc.
-- ---------------------------------------------------------------------
create table inventory_opening (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references products(id),
  year        int  not null,
  quarter     int  not null check (quarter between 1 and 4),
  quantity    numeric(18,4) not null default 0,  -- số lượng tồn đầu
  unit_cost   numeric(18,4) not null default 0,  -- đơn giá vốn tồn đầu
  created_at  timestamptz not null default now(),
  unique (product_id, year, quarter)
);
comment on table inventory_opening is 'Tồn kho đầu kỳ theo SKU + quý. Nhập tay hoặc import Excel.';

-- ---------------------------------------------------------------------
-- 7. GIÁ VỐN CHỐT THEO KỲ (sinh ra khi bấm "Chốt kỳ")
--    Lưu đơn giá bình quân gia quyền cuối kỳ + giá vốn đã xuất trong kỳ.
-- ---------------------------------------------------------------------
create table cogs_period (
  id             bigint generated always as identity primary key,
  product_id     bigint not null references products(id),
  year           int not null,
  quarter        int not null check (quarter between 1 and 4),
  opening_qty    numeric(18,4) not null default 0,
  opening_value  numeric(18,2) not null default 0,
  purchase_qty   numeric(18,4) not null default 0,
  purchase_value numeric(18,2) not null default 0,
  avg_unit_cost  numeric(18,4) not null default 0,  -- (opening_value+purchase_value)/(opening_qty+purchase_qty)
  sold_qty       numeric(18,4) not null default 0,
  cogs_value     numeric(18,2) not null default 0,  -- sold_qty * avg_unit_cost
  closing_qty    numeric(18,4) not null default 0,
  closing_value  numeric(18,2) not null default 0,
  created_at     timestamptz not null default now(),
  unique (product_id, year, quarter)
);
comment on table cogs_period is 'Kết quả tính giá vốn BQGQ cuối kỳ. Sinh khi chốt kỳ.';

-- ---------------------------------------------------------------------
-- 8. SỔ TIỀN MẶT (nhập tay, theo dõi số dư)
-- ---------------------------------------------------------------------
create table cash_book (
  id          bigint generated always as identity primary key,
  tx_date     date not null,
  direction   text not null check (direction in ('in','out')),  -- thu / chi
  amount      numeric(18,2) not null check (amount >= 0),
  description text,
  partner_id  bigint references partners(id),  -- nhãn đối tác (tùy chọn), để tự đối chiếu
  created_at  timestamptz not null default now()
);
comment on table cash_book is 'Sổ quỹ tiền mặt. Độc lập, chỉ theo dõi dòng tiền + số dư.';
create index idx_cash_date on cash_book (tx_date);

-- ---------------------------------------------------------------------
-- 9. SỔ NGÂN HÀNG (nhập tay, theo dõi số dư)
-- ---------------------------------------------------------------------
create table bank_book (
  id           bigint generated always as identity primary key,
  tx_date      date not null,
  direction    text not null check (direction in ('in','out')),
  amount       numeric(18,2) not null check (amount >= 0),
  description  text,
  bank_account text,                             -- tên/số TK ngân hàng
  partner_id   bigint references partners(id),   -- nhãn đối tác (tùy chọn)
  created_at   timestamptz not null default now()
);
comment on table bank_book is 'Sổ ngân hàng. Độc lập, chỉ theo dõi dòng tiền + số dư.';
create index idx_bank_date on bank_book (tx_date);

-- =====================================================================
-- 10. TRIGGER: tự tính thành tiền trên từng dòng hóa đơn,
--     và cập nhật tổng tiền trên đầu hóa đơn.
-- =====================================================================

-- 10a. tính line_before_tax / line_tax / line_total cho 1 dòng
create or replace function fn_item_compute()
returns trigger language plpgsql as $$
begin
  new.line_before_tax := round(new.quantity * new.unit_price, 2);
  new.line_tax        := round(new.line_before_tax * new.vat_rate / 100.0, 2);
  new.line_total      := new.line_before_tax + new.line_tax;
  return new;
end $$;

create trigger trg_item_compute
  before insert or update on invoice_items
  for each row execute function fn_item_compute();

-- 10b. cộng lại tổng của đầu hóa đơn mỗi khi dòng thay đổi
create or replace function fn_invoice_rollup()
returns trigger language plpgsql as $$
declare
  v_invoice bigint := coalesce(new.invoice_id, old.invoice_id);
begin
  update invoices i set
    amount_before_tax = coalesce(s.b,0),
    tax_amount        = coalesce(s.t,0),
    amount_total      = coalesce(s.b,0) + coalesce(s.t,0)
  from (
    select sum(line_before_tax) b, sum(line_tax) t
    from invoice_items where invoice_id = v_invoice
  ) s
  where i.id = v_invoice;
  return null;
end $$;

create trigger trg_invoice_rollup
  after insert or update or delete on invoice_items
  for each row execute function fn_invoice_rollup();

-- =====================================================================
-- 11. VIEW BÁO CÁO
-- =====================================================================

-- 11a. TỒN KHO HIỆN TẠI (số lượng) — suy từ hóa đơn + tồn đầu kỳ
--      Giá trị tồn chỉ chính xác sau khi chốt kỳ (cogs_period).
create view v_inventory_onhand as
with opening as (
  select product_id, sum(quantity) qty, sum(quantity*unit_cost) val
  from inventory_opening group by product_id
),
moves as (
  select ii.product_id,
         sum(case when inv.direction='in'  then ii.quantity else 0 end) in_qty,
         sum(case when inv.direction='out' then ii.quantity else 0 end) out_qty
  from invoice_items ii
  join invoices inv on inv.id = ii.invoice_id
  where ii.product_id is not null
  group by ii.product_id
)
select p.id as product_id, p.sku, p.name, p.unit,
       coalesce(o.qty,0)                                        as opening_qty,
       coalesce(m.in_qty,0)                                     as purchased_qty,
       coalesce(m.out_qty,0)                                    as sold_qty,
       coalesce(o.qty,0) + coalesce(m.in_qty,0) - coalesce(m.out_qty,0) as onhand_qty
from products p
left join opening o on o.product_id = p.id
left join moves   m on m.product_id = p.id
where p.kind = 'goods';
comment on view v_inventory_onhand is 'Tồn kho hiện tại theo số lượng (opening + mua - bán).';

-- 11b. VAT PHẢI NỘP THEO QUÝ
--      Thuế đầu ra (bán) - Thuế đầu vào được khấu trừ (mua & vat_deductible)
create view v_vat_by_quarter as
select
  extract(year from invoice_date)::int                       as year,
  ((extract(month from invoice_date)::int - 1)/3 + 1)::int   as quarter,
  sum(case when direction='out' then tax_amount else 0 end)  as output_vat,
  sum(case when direction='in' and vat_deductible
           then tax_amount else 0 end)                       as deductible_input_vat,
  sum(case when direction='out' then tax_amount else 0 end)
    - sum(case when direction='in' and vat_deductible
               then tax_amount else 0 end)                   as vat_payable
from invoices
group by 1,2
order by 1,2;
comment on view v_vat_by_quarter is
  'VAT phải nộp mỗi quý. Âm = còn được khấu trừ chuyển kỳ sau.';

-- 11c. KẾT QUẢ KINH DOANH THEO QUÝ (tạm tính)
--      Doanh thu = tổng chưa thuế hóa đơn bán.
--      Giá vốn   = lấy từ cogs_period (chỉ có sau khi chốt kỳ).
--      Chi phí   = tổng chưa thuế hóa đơn mua loại dịch vụ
--                  + phần thuế không khấu trừ của hóa đơn mua.
create view v_pl_by_quarter as
with rev as (  -- doanh thu thuần
  select extract(year from invoice_date)::int y,
         ((extract(month from invoice_date)::int-1)/3+1)::int q,
         sum(amount_before_tax) revenue
  from invoices where direction='out' group by 1,2
),
exp_service as (  -- chi phí từ hóa đơn mua dịch vụ
  select extract(year from invoice_date)::int y,
         ((extract(month from invoice_date)::int-1)/3+1)::int q,
         sum(amount_before_tax) expense
  from invoices where direction='in' and category='service' group by 1,2
),
exp_nondeduct as (  -- thuế không khấu trừ -> tính vào chi phí
  select extract(year from invoice_date)::int y,
         ((extract(month from invoice_date)::int-1)/3+1)::int q,
         sum(tax_amount) nd_tax
  from invoices where direction='in' and vat_deductible=false group by 1,2
),
cogs as (  -- giá vốn đã chốt
  select year y, quarter q, sum(cogs_value) cogs
  from cogs_period group by 1,2
)
select
  coalesce(r.y,s.y,n.y,c.y) as year,
  coalesce(r.q,s.q,n.q,c.q) as quarter,
  coalesce(r.revenue,0)                                   as revenue,
  coalesce(c.cogs,0)                                      as cogs,
  coalesce(s.expense,0) + coalesce(n.nd_tax,0)            as expenses,
  coalesce(r.revenue,0) - coalesce(c.cogs,0)
    - coalesce(s.expense,0) - coalesce(n.nd_tax,0)        as profit
from rev r
full join exp_service   s on s.y=r.y and s.q=r.q
full join exp_nondeduct n on n.y=coalesce(r.y,s.y) and n.q=coalesce(r.q,s.q)
full join cogs          c on c.y=coalesce(r.y,s.y,n.y) and c.q=coalesce(r.q,s.q,n.q)
order by 1,2;
comment on view v_pl_by_quarter is
  'KQKD theo quý. Giá vốn chỉ có sau khi chốt kỳ (nếu trống = chưa chốt).';

-- =====================================================================
-- 12. HÀM CHỐT KỲ: tính giá vốn BQGQ cuối kỳ cho một quý
--     Gọi: select close_period(2026, 1);
-- =====================================================================
create or replace function close_period(p_year int, p_quarter int)
returns void language plpgsql
set search_path = ketoan, public as $$
declare
  m_start date := make_date(p_year, (p_quarter-1)*3 + 1, 1);
  m_end   date := (make_date(p_year, (p_quarter-1)*3 + 1, 1) + interval '3 months')::date;
begin
  -- không cho chốt lại kỳ đã đóng
  if exists (select 1 from periods
             where year=p_year and quarter=p_quarter and status='closed') then
    raise exception 'Kỳ %/Q% đã được chốt.', p_year, p_quarter;
  end if;

  -- xóa kết quả cũ nếu tính lại
  delete from cogs_period where year=p_year and quarter=p_quarter;

  insert into cogs_period(
    product_id, year, quarter,
    opening_qty, opening_value, purchase_qty, purchase_value,
    avg_unit_cost, sold_qty, cogs_value, closing_qty, closing_value)
  select
    p.id, p_year, p_quarter,
    o.qty, o.val, pu.qty, pu.val,
    -- đơn giá bình quân gia quyền cuối kỳ
    case when (o.qty + pu.qty) > 0
         then round((o.val + pu.val) / (o.qty + pu.qty), 4) else 0 end as avg_cost,
    sa.qty,
    round(sa.qty * case when (o.qty+pu.qty)>0
         then (o.val+pu.val)/(o.qty+pu.qty) else 0 end, 2) as cogs,
    (o.qty + pu.qty - sa.qty) as close_qty,
    round((o.qty + pu.qty - sa.qty) * case when (o.qty+pu.qty)>0
         then (o.val+pu.val)/(o.qty+pu.qty) else 0 end, 2) as close_val
  from products p
  left join lateral (
    select coalesce(quantity,0) qty, coalesce(quantity*unit_cost,0) val
    from inventory_opening
    where product_id=p.id and year=p_year and quarter=p_quarter
  ) o on true
  left join lateral (  -- mua trong kỳ
    select coalesce(sum(ii.quantity),0) qty,
           coalesce(sum(ii.line_before_tax),0) val
    from invoice_items ii join invoices i on i.id=ii.invoice_id
    where ii.product_id=p.id and i.direction='in'
      and i.invoice_date >= m_start and i.invoice_date < m_end
  ) pu on true
  left join lateral (  -- bán trong kỳ
    select coalesce(sum(ii.quantity),0) qty
    from invoice_items ii join invoices i on i.id=ii.invoice_id
    where ii.product_id=p.id and i.direction='out'
      and i.invoice_date >= m_start and i.invoice_date < m_end
  ) sa on true
  where p.kind='goods';

  -- đánh dấu kỳ đã chốt
  insert into periods(year, quarter, status, closed_at)
  values (p_year, p_quarter, 'closed', now())
  on conflict (year, quarter)
  do update set status='closed', closed_at=now();
end $$;
comment on function close_period is
  'Chốt kỳ: tính giá vốn BQGQ cuối kỳ cho mọi SKU, ghi vào cogs_period.';
