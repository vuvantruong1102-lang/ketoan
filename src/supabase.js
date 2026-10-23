import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Lỗi rõ ràng ngay khi thiếu cấu hình, thay vì màn hình trắng khó hiểu.
  throw new Error(
    'Thiếu biến môi trường Supabase. Hãy tạo file .env với VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY.'
  )
}

export const supabase = createClient(url, anonKey)
