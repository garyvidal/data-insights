import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { DatabaseProvider } from './context/DatabaseContext'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import DistributionPage from './pages/DistributionPage'
import AnalyzePage from './pages/AnalyzePage'
import CoveragePage from './pages/CoveragePage'

export default function App() {
  return (
    <BrowserRouter>
      <DatabaseProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/home" replace />} />
            <Route path="home" element={<HomePage />} />
            <Route path="distribution" element={<DistributionPage />} />
            <Route path="analyze" element={<AnalyzePage />} />
            <Route path="coverage" element={<CoveragePage />} />
          </Route>
        </Routes>
      </DatabaseProvider>
    </BrowserRouter>
  )
}
