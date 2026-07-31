import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Uncaught error:', error, info.componentStack)
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg-deep p-8 text-center">
          <h1 className="text-2xl font-bold text-red-400">应用遇到错误</h1>
          <p className="max-w-md text-sm text-text-muted">
            {this.state.error?.message ?? '未知错误'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={this.handleReload}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              重试
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated"
            >
              刷新页面
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
