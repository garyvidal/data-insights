import { useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import DatabaseSelector from './DatabaseSelector'

const MIN_WIDTH = 160
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 224
const COLLAPSED_WIDTH = 48

const navItems = [
  { to: '/home', label: 'Home' },
  { to: '/distribution', label: 'Distribution' },
  { to: '/analyze', label: 'Analyze' },
  { to: '/coverage', label: 'Coverage' },
]

export default function Layout() {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [collapsed, setCollapsed] = useState(false)
  const dragStart = useRef<{ x: number; w: number } | null>(null)

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
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside
        className="flex-shrink-0 bg-gray-900 text-white flex flex-col relative"
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
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              className={({ isActive }) =>
                `flex items-center rounded-md text-sm font-medium transition-colors overflow-hidden whitespace-nowrap ${
                  collapsed ? 'justify-center px-1 py-2' : 'px-3 py-2'
                } ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              {collapsed ? (
                <span className="font-bold text-xs">{item.label[0]}</span>
              ) : (
                item.label
              )}
            </NavLink>
          ))}
        </nav>



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
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
