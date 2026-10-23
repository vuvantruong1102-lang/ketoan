-- RLS cho Supabase — chạy SAU schema.sql, trên Supabase (có role authenticated).
-- Một người dùng: mọi user đã đăng nhập đều toàn quyền.
-- =====================================================================
-- 13. RLS CƠ BẢN (một người dùng — mọi user đã đăng nhập đều toàn quyền)
--     Khi cần nhiều user/phân quyền sâu hơn, siết lại ở giai đoạn sau.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'periods','partners','products','invoices','invoice_items',
    'inventory_opening','cogs_period','cash_book','bank_book'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$
      create policy %1$s_authenticated on %1$I
      for all to authenticated using (true) with check (true);
    $p$, t);
  end loop;
end $$;

-- =====================================================================
-- HẾT SCHEMA. Bước tiếp theo: tạo vài dòng dữ liệu mẫu để kiểm tra,
-- rồi mới dựng app React lên trên.
-- =====================================================================
