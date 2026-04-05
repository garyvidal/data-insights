import { useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import DatabaseSelector from './DatabaseSelector'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

const MIN_WIDTH = 160
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 224
const COLLAPSED_WIDTH = 48

const HomeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)

const DistributionIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
)

const AnalyzeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
)

const SchemaIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    <polyline points="9 6 9 2 15 2" />
  </svg>
)

const navItems = [
  { to: '/home', label: 'Home', Icon: HomeIcon },
  { to: '/distribution', label: 'Distribution', Icon: DistributionIcon },
  { to: '/analyze', label: 'Analyze', Icon: AnalyzeIcon },
  { to: '/schema', label: 'Schema', Icon: SchemaIcon },
  // { to: '/coverage', label: 'Coverage' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [collapsed, setCollapsed] = useState(false)
  const dragStart = useRef<{ x: number; w: number } | null>(null)

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    dragStart.current = { x: e.clientX, w: width }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(e: MouseEvent) {
      if (!dragStart.current) return
      const delta = e.clientX - dragStart.current.x
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStart.current.w + delta)))
    }
    function onUp() {
      dragStart.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const effectiveWidth = collapsed ? COLLAPSED_WIDTH : width

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 dark:text-gray-100">
      {/* Sidebar */}
      <aside
        className="flex-shrink-0 bg-gray-900 dark:bg-gray-950 text-white flex flex-col relative border-r border-gray-700 dark:border-gray-800"
        style={{ width: effectiveWidth, transition: 'width 0.15s ease' }}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-700 overflow-hidden whitespace-nowrap">
          {!collapsed && (
            <>
              <h1 className="text-lg font-bold tracking-tight">Data Insights</h1>
              <p className="text-xs text-gray-400 mt-0.5">MarkLogic Analyzer</p>
            </>
          )}
          {collapsed && <div className="h-10" />}
        </div>
        {/* Database selector */}
        {!collapsed && (
          <div className="p-3 border-t border-gray-700">
            <DatabaseSelector />
          </div>
        )}
        {/* Nav */}
        <nav className="flex-1 p-2 space-y-1 overflow-hidden">
          {navItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md text-sm font-medium transition-colors overflow-hidden whitespace-nowrap ${
                  collapsed ? 'justify-center px-1 py-2' : 'px-3 py-2'
                } ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <Icon />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>



        {/* User / logout */}
        <div className={`border-t border-gray-700 dark:border-gray-800 space-y-1 ${collapsed ? 'p-2' : 'p-3'}`}>
          {collapsed ? (
            <div className="flex flex-col gap-1">
              <button
                onClick={toggleTheme}
                title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                className="w-full flex items-center justify-center py-1 text-gray-400 hover:text-white transition-colors"
              >
                {theme === 'light' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                )}
              </button>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="w-full flex items-center justify-center py-1 text-gray-400 hover:text-white transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-400 truncate" title={user ?? ''}>{user}</span>
                <button
                  onClick={toggleTheme}
                  title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                  className="flex-shrink-0 text-xs text-gray-400 hover:text-white transition-colors p-1"
                >
                  {theme === 'light' ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" />
                      <line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                  )}
                </button>
              </div>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="w-full text-xs text-gray-400 hover:text-white transition-colors text-left"
              >
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* Resize handle */}
        {!collapsed && (
          <div
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500 transition-colors"
            onMouseDown={onResizeMouseDown}
          />
        )}

        {/* Collapse/expand toggle */}
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute z-20 flex items-center justify-center w-5 h-5 rounded-full bg-gray-700 border border-gray-500 text-gray-300 hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-colors shadow-md text-xs"
          style={{ right: '-10px', top: '56px' }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-950">
        <Outlet />
      </main>
    </div>
  )
}
