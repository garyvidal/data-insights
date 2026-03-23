interface Props {
  show: boolean
  message?: string
}

export default function LoadingOverlay({ show, message = 'Loading...' }: Props) {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-lg px-8 py-6 flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-600">{message}</p>
      </div>
    </div>
  )
}
