/*
 * Global error boundary. Catches render errors anywhere in the tree and shows a
 * recoverable screen instead of a blank page. (Error boundaries must be class
 * components.)
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="card" style={{ maxWidth: 460, padding: 32, textAlign: 'center' }}>
          <i className="fas fa-triangle-exclamation" style={{ fontSize: 32, color: 'var(--danger)' }} />
          <h1 className="section-title" style={{ fontSize: 24, margin: '14px 0 8px' }}>Something went wrong</h1>
          <p style={{ color: 'var(--text-muted)', margin: '0 0 20px', lineHeight: 1.6 }}>
            An unexpected error occurred. Reloading usually fixes it.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
            <a className="btn btn-ghost" href="/">Go home</a>
          </div>
        </div>
      </div>
    )
  }
}
