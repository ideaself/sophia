/**
 * Inline error row for the message list (extracted from ClassroomView).
 */
export function ChatErrorRow({
  message,
  onRetry
}: {
  message?: string
  onRetry?: () => void
}): React.ReactElement {
  return (
    <div className="rounded border border-red-700/50 bg-red-900/20 px-4 py-3 text-sm text-red-500">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">发送失败</p>
          <p className="mt-1 text-xs text-red-500/80">{message}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600"
          >
            重试
          </button>
        )}
      </div>
    </div>
  )
}
