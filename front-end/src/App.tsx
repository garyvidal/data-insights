import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { DatabaseProvider } from './context/DatabaseContext'
import { ThemeProvider } from './context/ThemeContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import DistributionPage from './pages/DistributionPage'
import AnalyzePage from './pages/AnalyzePage'
import { SchemaManagementPage } from './pages/SchemaManagementPage'
import UploadPage from './pages/UploadPage'
import SearchPage from './pages/SearchPage'
import AlertDialog from './components/AlertDialog'

function PrivateRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function SessionExpiredDialog() {
  const { sessionExpired, dismissSessionExpired } = useAuth()
  const navigate = useNavigate()

  function handleClose() {
    dismissSessionExpired()
    navigate('/login', { replace: true })
  }

  return (
    <AlertDialog
      open={sessionExpired}
      title="Session Expired"
      message="Your session has expired. Please log in again to continue."
      onClose={handleClose}
    />
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <SessionExpiredDialog />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <PrivateRoute>
                  <DatabaseProvider>
                    <Layout />
                  </DatabaseProvider>
                </PrivateRoute>
              }
            >
              <Route index element={<Navigate to="/home" replace />} />
              <Route path="home" element={<HomePage />} />
              <Route path="distribution" element={<DistributionPage />} />
              <Route path="analyze" element={<AnalyzePage />} />
              <Route path="schema" element={<SchemaManagementPage />} />
              <Route path="upload" element={<UploadPage />} />
              <Route path="search" element={<SearchPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
