# Kế toán Yokool — Phần mềm kế toán nội bộ

Phần mềm kế toán nội bộ đơn giản theo **Thông tư 133/2016**, phục vụ bốn mục tiêu:
theo dõi **lợi nhuận**, **thuế VAT phải nộp theo quý**, **tồn kho**, và ghi chép
**sổ tiền mặt / ngân hàng**.

Stack: **React + Vite** (frontend) · **Supabase/PostgreSQL** (database + đăng nhập) ·
**Vercel** (hosting).

---

## Giai đoạn 1 — những gì đã có

- Danh mục **đối tác** (NCC + khách hàng) và **sản phẩm** theo SKU
- Nhập **hóa đơn** mua vào / bán ra, tự tính thuế và tổng tiền
  - Phân loại hàng hóa / dịch vụ
  - Cờ **VAT không được khấu trừ** → thuế dồn vào chi phí
- **Tồn kho** theo SKU (suy ra từ hóa đơn) + tồn đầu kỳ nhập tay hoặc **import Excel**
- **Giá vốn bình quân gia quyền cuối kỳ**, tính khi **chốt kỳ**
- **Sổ tiền mặt** và **sổ ngân hàng** (nhập tay, theo dõi số dư)
- Báo cáo **Kết quả kinh doanh** và **VAT phải nộp** theo quý

Chưa làm (giai đoạn 2): đối chiếu Shopee, bảng lương, hồ sơ nhân viên, bảng cân đối
kế toán B01-DNN, checklist quý, tư vấn hồ sơ chứng từ.

---

## Cài đặt

### 1. Database (Supabase)

1. Vào project Supabase → **SQL Editor**.
2. Mở `supabase/schema.sql`, dán toàn bộ, bấm **Run**. (Tạo bảng, trigger, view, hàm chốt kỳ.)
3. Mở `supabase/schema_rls.sql`, dán, **Run**. (Bật bảo mật RLS.)
4. Tạo tài khoản đăng nhập: **Authentication → Users → Add user** (nhập email + mật khẩu,
   bật *Auto Confirm*). Phần mềm không mở đăng ký công khai vì dùng nội bộ.

> ⚠️ Trong `schema.sql` có khối `DROP ... CASCADE` ở đầu để tiện chạy lại khi thử nghiệm.
> **Khi đã nhập dữ liệu thật, hãy xóa khối đó đi** (có ghi chú cảnh báo tại chỗ), nếu không
> chạy lại file sẽ mất sạch dữ liệu.

### 2. Lấy khóa API

Supabase → **Project Settings → API**, copy:
- **Project URL** → `VITE_SUPABASE_URL`
- **anon public key** → `VITE_SUPABASE_ANON_KEY`

### 3. Chạy thử ở máy

```bash
npm install
cp .env.example .env     # rồi điền URL + anon key vào .env
npm run dev
```

Mở http://localhost:5173

### 4. Deploy lên Vercel

1. Đẩy code lên GitHub.
2. Vercel → **New Project** → chọn repo này.
3. **Environment Variables**, thêm hai biến:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. **Deploy**. (File `vercel.json` đã cấu hình sẵn rewrite để React Router hoạt động khi tải lại trang.)

---

## Cách dùng theo quý

1. Khai báo đối tác + sản phẩm (làm một lần, bổ sung dần).
2. Nhập **tồn kho đầu kỳ** cho quý. File Excel import cần 3 cột: `sku`, `quantity`, `unit_cost`
   (bấm *Tải file mẫu* trong trang Tồn kho).
3. Nhập hóa đơn mua / bán phát sinh trong quý.
4. Ghi giao dịch tiền mặt / ngân hàng.
5. Cuối quý: vào **Báo cáo → Chốt kỳ**. Phần mềm tính giá vốn bình quân gia quyền cuối kỳ;
   lợi nhuận và giá vốn chuyển từ *tạm tính* sang *chính thức*.

---

## Lưu ý quan trọng

- Giá vốn dùng **bình quân gia quyền cuối kỳ**: trong kỳ, lợi nhuận là *tạm tính*; chỉ
  chính xác sau khi chốt kỳ.
- Tồn kho **suy ra từ hóa đơn** — mọi nhập/xuất phải đi qua một hóa đơn. Hóa đơn hàng hóa
  bắt buộc chọn SKU ở mỗi dòng.
- Phần mềm này để **theo dõi và kiểm tra nội bộ**. Báo cáo nộp cơ quan thuế vẫn nên đối
  chiếu với kế toán hoặc phần mềm có kết xuất chuẩn Tổng cục Thuế.
- Tiền VND, làm tròn về số nguyên đồng khi hiển thị; nội bộ giữ số lẻ cho giá vốn bình quân.

---

## Cấu trúc thư mục

```
app/
├─ supabase/
│  ├─ schema.sql        # tạo toàn bộ database (chạy trước)
│  └─ schema_rls.sql    # bật bảo mật RLS (chạy sau)
├─ src/
│  ├─ lib/              # supabase client, auth, hàm định dạng
│  ├─ components/       # Layout, các UI dùng chung
│  └─ pages/            # Dashboard, Partners, Products, Invoices,
│                       # Inventory, CashBank, Reports
├─ vercel.json
└─ .env.example
```
