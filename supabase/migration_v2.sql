-- =====================================================================
-- MIGRATION V2: chống trùng hóa đơn, VAT khấu trừ kỳ trước, tài khoản ngân hàng
-- Chạy trong Supabase > SQL Editor. An toàn chạy nhiều lần.
-- Mọi thứ trong schema ketoan — không đụng app khác.
-- =====================================================================

set search_path = ketoan, public;

-- ---------------------------------------------------------------------
-- 1. CHẶN TRÙNG SỐ HÓA ĐƠN + CÙNG NHÀ CUNG CẤP
--    (chỉ áp dụng khi có cả số HĐ và NCC; bỏ qua dòng thiếu một trong hai)
-- ---------------------------------------------------------------------
create unique index if not exists uq_invoice_no_partner
  on ketoan.invoices (direction, partner_id, invoice_no)
  where invoice_no is not null and partner_id is not null;

-- ---------------------------------------------------------------------
-- 2. THUẾ GTGT ĐƯỢC KHẤU TRỪ KỲ TRƯỚC CHUYỂN SANG (theo quý)
-- ---------------------------------------------------------------------
create table if not exists vat_carryover (
  id          bigint generated always as identity primary key,
  year        int  not null,
  quarter     int  not null check (quarter between 1 and 4),
  amount      numeric(18,2) not null default 0,  -- số thuế còn được khấu trừ kỳ trước
  note        text,
  created_at  timestamptz not null default now(),
  unique (year, quarter)
);
comment on table vat_carryover is 'Thuế GTGT còn được khấu trừ chuyển sang từ kỳ trước (nhập tay theo quý).';

-- ---------------------------------------------------------------------
-- 3. TÀI KHOẢN NGÂN HÀNG + GIAO DỊCH
-- ---------------------------------------------------------------------
create table if not exists bank_accounts (
  id            bigint generated always as identity primary key,
  name          text not null,                  -- tên gợi nhớ: "VCB chính", "ACB"...
  bank          text,                           -- tên ngân hàng
  account_no    text,                           -- số tài khoản
  opening_balance numeric(18,2) not null default 0,  -- số dư đầu kỳ
  is_active     boolean not null default true,
  note          text,
  created_at    timestamptz not null default now()
);
comment on table bank_accounts is 'Danh mục tài khoản ngân hàng của công ty.';

create table if not exists bank_tx (
  id           bigint generated always as identity primary key,
  account_id   bigint not null references ketoan.bank_accounts(id) on delete cascade,
  tx_date      date not null,
  direction    text not null check (direction in ('in','out')),  -- thu / chi
  amount       numeric(18,2) not null check (amount >= 0),
  description  text,
  created_at   timestamptz not null default now()
);
comment on table bank_tx is 'Giao dịch phát sinh của từng tài khoản ngân hàng.';
create index if not exists idx_bank_tx_acc on bank_tx (account_id, tx_date);

-- ---------------------------------------------------------------------
-- 4. CẤP QUYỀN + RLS cho các bảng mới
-- ---------------------------------------------------------------------
grant all on vat_carryover, bank_accounts, bank_tx to anon, authenticated, service_role;
grant all on all sequences in schema ketoan to anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['vat_carryover','bank_accounts','bank_tx'] loop
    if not exists (select 1 from pg_policies where schemaname='ketoan' and tablename=t) then
      execute format('alter table ketoan.%I enable row level security;', t);
      execute format($p$create policy %1$s_auth on ketoan.%1$I
        for all to authenticated using (true) with check (true);$p$, t);
    end if;
  end loop;
end $$;

-- =====================================================================
-- Xong. Sổ tiền mặt (cash_book) và sổ ngân hàng cũ (bank_book) vẫn còn
-- trong DB nhưng không dùng ở giao diện mới — không xóa để an toàn.
-- =====================================================================
