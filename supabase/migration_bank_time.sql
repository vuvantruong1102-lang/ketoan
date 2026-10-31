-- =====================================================================
-- MIGRATION: thêm thời điểm giao dịch (giờ:phút:giây) cho sổ ngân hàng
-- để sắp xếp đúng thứ tự các giao dịch TRONG CÙNG MỘT NGÀY.
-- An toàn chạy nhiều lần.
-- =====================================================================

set search_path = ketoan, public;

-- tx_at: thời điểm đầy đủ. Nếu sao kê không có giờ, để NULL và dùng tx_date.
alter table ketoan.bank_tx
  add column if not exists tx_at timestamptz;

-- Với dữ liệu cũ chưa có giờ: gán tx_at = đầu ngày của tx_date để không vỡ thứ tự.
update ketoan.bank_tx set tx_at = tx_date::timestamptz where tx_at is null;

-- index theo tài khoản + thời điểm (phục vụ sắp xếp)
create index if not exists idx_bank_tx_acc_at on ketoan.bank_tx (account_id, tx_at);

-- =====================================================================
-- Xong. Giao dịch giờ sắp theo tx_at (ngày + giờ), hết âm sổ sai thứ tự.
-- =====================================================================
