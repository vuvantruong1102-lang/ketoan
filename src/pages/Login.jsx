import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Alert } from '../components/ui'

export default function Login() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) return <div className="spin">Đang tải…</div>
  if (session) return <Navigate to="/" replace />

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setErr('Email hoặc mật khẩu không đúng.')
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Kế toán Yokool</h1>
        <div className="sub">Đăng nhập để quản lý sổ sách nội bộ</div>
        <Alert>{err}</Alert>
        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label>Mật khẩu</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn accent" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
        <p className="inline-note" style={{ marginTop: 16 }}>
          Tài khoản được tạo trong Supabase → Authentication → Users. Phần mềm này
          dành cho nội bộ nên không mở đăng ký công khai.
        </p>
      </div>
    </div>
  )
}
