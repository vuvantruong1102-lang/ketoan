import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Lỗi rõ ràng ngay khi thiếu cấu hình, thay vì màn hình trắng khó hiểu.
  throw new Error(
    'Thiếu biến môi trường Supabase. Hãy tạo file .env với VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY.'
  )
}

// App dùng CHUNG project Supabase với nhiều app khác, nên mọi bảng của app
// kế toán nằm trong schema riêng "ketoan". Mọi lời gọi .from(...) và .rpc(...)
// sẽ tự trỏ vào schema này.
// Lưu ý: schema "ketoan" phải được thêm vào Project Settings → API →
// Exposed schemas, nếu không API sẽ từ chối.
export const supabase = createClient(url, anonKey, {
  db: { schema: 'ketoan' },
})
