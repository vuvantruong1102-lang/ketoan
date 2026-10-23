-- =====================================================================
-- MIGRATION: cho phép sửa tay tiền thuế / thành tiền trên từng dòng hóa đơn
-- Dùng khi database ĐÃ chạy schema.sql trước đó (không muốn làm lại từ đầu).
-- An toàn khi chạy nhiều lần.
-- Chạy trong Supabase > SQL Editor. (Mọi thứ nằm trong schema ketoan.)
-- =====================================================================

set search_path = ketoan, public;

-- 1. Thêm 2 cột ghi đè (nếu chưa có)
alter table ketoan.invoice_items
  add column if not exists amount_override numeric(18,2),
  add column if not exists tax_override    numeric(18,2);

-- ràng buộc không âm (bỏ qua nếu đã tồn tại)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_amount_override_chk') then
    alter table ketoan.invoice_items
      add constraint invoice_items_amount_override_chk
      check (amount_override is null or amount_override >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_tax_override_chk') then
    alter table ketoan.invoice_items
      add constraint invoice_items_tax_override_chk
      check (tax_override is null or tax_override >= 0);
  end if;
end $$;

-- 2. Cập nhật trigger tính toán để ưu tiên số ghi đè
create or replace function ketoan.fn_item_compute()
returns trigger language plpgsql as $$
begin
  new.line_before_tax := coalesce(new.amount_override,
                                  round(new.quantity * new.unit_price, 2));
  new.line_tax        := coalesce(new.tax_override,
                                  round(new.line_before_tax * new.vat_rate / 100.0, 2));
  new.line_total      := new.line_before_tax + new.line_tax;
  return new;
end $$;

-- Trigger đã tồn tại từ schema.sql, trỏ sẵn tới hàm này nên không cần tạo lại.
-- (Nếu muốn chắc chắn, bỏ ghi chú 2 dòng dưới để tạo lại trigger.)
-- drop trigger if exists trg_item_compute on ketoan.invoice_items;
-- create trigger trg_item_compute before insert or update on ketoan.invoice_items
--   for each row execute function ketoan.fn_item_compute();

-- =====================================================================
-- Xong. Giờ mỗi dòng hóa đơn có thể để trống (tự tính) hoặc nhập tay
-- tiền thuế / thành tiền để khớp đúng hóa đơn nhà cung cấp.
-- =====================================================================
