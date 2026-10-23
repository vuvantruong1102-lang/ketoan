import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Partners from './pages/Partners'
import Products from './pages/Products'
import Invoices from './pages/Invoices'
import CashBank from './pages/CashBank'
import Reports from './pages/Reports'
import './index.css'

// Tách riêng trang Tồn kho vì nó kéo theo thư viện xlsx (nặng).
const Inventory = lazy(() => import('./pages/Inventory'))

function Protected({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="spin">Đang tải…</div>
  if (!session) return <Navigate to="/login" replace />
  return children
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="partners" element={<Partners />} />
        <Route path="products" element={<Products />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="inventory" element={
          <Suspense fallback={<div className="spin">Đang tải…</div>}><Inventory /></Suspense>
        } />
        <Route path="cashbank" element={<CashBank />} />
        <Route path="reports" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
