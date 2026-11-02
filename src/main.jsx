import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Partners from './pages/Partners'
import Products from './pages/Products'
import Expenses from './pages/Expenses'
import InvoicesIn from './pages/InvoicesIn'
import InvoicesOut from './pages/InvoicesOut'
import ProfitReport from './pages/ProfitReport'
import VatReport from './pages/VatReport'
import ShopeeAffiliate from './pages/ShopeeAffiliate'
import AkaReconcile from './pages/AkaReconcile'
import './index.css'

// Tách riêng các trang kéo theo xlsx (nặng).
const Inventory = lazy(() => import('./pages/Inventory'))
const BankAccounts = lazy(() => import('./pages/BankAccounts'))

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
        <Route path="invoices-in" element={<InvoicesIn />} />
        <Route path="invoices-out" element={<InvoicesOut />} />
        <Route path="inventory" element={
          <Suspense fallback={<div className="spin">Đang tải…</div>}><Inventory /></Suspense>
        } />
        <Route path="bank" element={
          <Suspense fallback={<div className="spin">Đang tải…</div>}><BankAccounts /></Suspense>
        } />
        <Route path="expenses" element={<Expenses />} />
        <Route path="shopee" element={<ShopeeAffiliate />} />
        <Route path="aka" element={<AkaReconcile />} />
        <Route path="profit" element={<ProfitReport />} />
        <Route path="vat" element={<VatReport />} />
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
