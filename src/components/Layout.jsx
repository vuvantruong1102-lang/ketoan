import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const link = ({ isActive }) => (isActive ? 'active' : '')

export default function Layout() {
  const { user, signOut } = useAuth()
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          Kế toán Yokool
          <small>Thông tư 133/2016</small>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={link}>Tổng quan</NavLink>

          <div className="group-label">Danh mục</div>
          <NavLink to="/partners" className={link}>Đối tác</NavLink>
          <NavLink to="/products" className={link}>Sản phẩm</NavLink>

          <div className="group-label">Nghiệp vụ</div>
          <NavLink to="/invoices" className={link}>Hóa đơn</NavLink>
          <NavLink to="/inventory" className={link}>Tồn kho</NavLink>
          <NavLink to="/cashbank" className={link}>Tiền mặt & Ngân hàng</NavLink>

          <div className="group-label">Báo cáo</div>
          <NavLink to="/reports" className={link}>Lợi nhuận · VAT · Chốt kỳ</NavLink>
        </nav>
        <div className="footer">
          <div>{user?.email}</div>
          <button onClick={signOut}>Đăng xuất</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
