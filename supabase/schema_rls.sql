-- =====================================================================
-- BẢO MẬT + MỞ API cho schema "ketoan"
-- Chạy SAU schema.sql, trên Supabase. An toàn với các app khác.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cho phép role của Supabase truy cập schema ketoan
--    (schema mới mặc định KHÔNG cấp quyền cho ai, nên phải grant tường minh)
-- ---------------------------------------------------------------------
grant usage on schema ketoan to anon, authenticated, service_role;
grant all on all tables    in schema ketoan to anon, authenticated, service_role;
grant all on all sequences in schema ketoan to anon, authenticated, service_role;
grant all on all functions in schema ketoan to anon, authenticated, service_role;
-- áp dụng cho cả bảng/sequence tạo thêm sau này
alter default privileges in schema ketoan
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema ketoan
  grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. RLS cơ bản — một người dùng: mọi user đã đăng nhập đều toàn quyền.
--    Bật cho mọi bảng trong schema ketoan (không đụng bảng public).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'periods','partners','products','invoices','invoice_items',
    'inventory_opening','cogs_period','cash_book','bank_book'
  ] loop
    execute format('alter table ketoan.%I enable row level security;', t);
    execute format($p$
      create policy %1$s_authenticated on ketoan.%1$I
      for all to authenticated using (true) with check (true);
    $p$, t);
  end loop;
end $$;

-- =====================================================================
-- 3. QUAN TRỌNG — MỞ schema ketoan cho API (làm TRÊN GIAO DIỆN, không phải SQL)
-- ---------------------------------------------------------------------
-- Mặc định Supabase chỉ cho API đọc/ghi schema "public". Schema "ketoan"
-- sẽ KHÔNG gọi được từ app cho tới khi bạn thêm nó vào danh sách exposed:
--
--   Dashboard -> Project Settings -> API -> "Exposed schemas"
--   -> them  ketoan  vao o, bam Save.
--
-- Neu khong lam buoc nay, app se bao loi kieu "schema must be one of...".
-- =====================================================================
