import { useEffect, useState } from 'react'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { useDatabase } from '../context/DatabaseContext'
import { getRootElements } from '../services/api'
import type { RootElement } from '../types'
import LoadingOverlay from '../components/LoadingOverlay'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316']

function buildChartData(elements: RootElement[]) {
  const byType: Record<string, number> = {}
  const byName: { name: string; value: number }[] = []

  for (const el of elements) {
    byType[el.type] = (byType[el.type] ?? 0) + el.frequency
    byName.push({ name: el.localname || el.type, value: el.frequency })
  }

  return byName.slice(0, 12) // limit pie slices
}

export default function DistributionPage() {
  const { selectedDb } = useDatabase()
  const [elements, setElements] = useState<RootElement[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedDb) return
    setLoading(true)
    getRootElements(selectedDb)
      .then(setElements)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedDb])

  const chartData = buildChartData(elements)
  const total = elements.reduce((s, e) => s + e.frequency, 0)

  return (
    <div className="p-6">
      <LoadingOverlay show={loading} message="Loading distribution data..." />

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Content Distribution</h2>
        <p className="text-gray-500 text-sm mt-1">
          {selectedDb} — {total.toLocaleString()} total documents
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Table */}
        <div className="card">
          <h3 className="font-semibold text-gray-700 mb-3">Root Elements</h3>
          <div className="table-container max-h-96">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th className="text-right">Count</th>
                  <th className="text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {elements.map(el => (
                  <tr key={el.id}>
                    <td>
                      <span
                        className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${
                          el.type === 'element'
                            ? 'bg-blue-100 text-blue-700'
                            : el.type === 'json'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {el.type}
                      </span>
                    </td>
                    <td className="font-mono text-xs">{el.localname}</td>
                    <td className="text-right">{el.frequency.toLocaleString()}</td>
                    <td className="text-right text-gray-500">
                      {total > 0 ? ((el.frequency / total) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                ))}
                {elements.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} className="text-center text-gray-400 py-8">
                      No data. Select a database with documents.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Chart */}
        <div className="card flex flex-col items-center">
          <h3 className="font-semibold text-gray-700 mb-3 self-start">Content Distribution</h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  dataKey="value"
                  label={({
                    cx, cy, midAngle, outerRadius: r, name, percent,
                  }: {
                    cx: number; cy: number; midAngle: number
                    outerRadius: number; name: string; percent: number
                  }) => {
                    if (percent < 0.04) return null
                    const RAD = Math.PI / 180
                    const x = cx + (r + 20) * Math.cos(-midAngle * RAD)
                    const y = cy + (r + 20) * Math.sin(-midAngle * RAD)
                    return (
                      <text
                        x={x} y={y}
                        fill="#374151"
                        textAnchor={x > cx ? 'start' : 'end'}
                        dominantBaseline="central"
                        fontSize={12}
                      >
                        {`${name} ${(percent * 100).toFixed(0)}%`}
                      </text>
                    )
                  }}
                  labelLine={({ midAngle, outerRadius: r, cx, cy, percent }: {
                    midAngle: number; outerRadius: number; cx: number; cy: number; percent: number
                  }) => {
                    if (percent < 0.04) return <g />
                    const RAD = Math.PI / 180
                    const x1 = cx + r * Math.cos(-midAngle * RAD)
                    const y1 = cy + r * Math.sin(-midAngle * RAD)
                    const x2 = cx + (r + 16) * Math.cos(-midAngle * RAD)
                    const y2 = cy + (r + 16) * Math.sin(-midAngle * RAD)
                    return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9ca3af" strokeWidth={1} />
                  }}
                >
                  {chartData.map((_, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [value.toLocaleString(), 'Documents']}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
              No data to chart
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
