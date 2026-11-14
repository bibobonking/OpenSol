import { Component, type ErrorInfo, type ReactNode } from 'react'
import { LogoMark } from './Logo'

interface State {
  error: Error | null
  copied: boolean
}

/** Keeps a render error from blanking the whole app; chats are already saved by the daemon. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, copied: false }

  static getDerivedStateFromError(error: Error): State {
    return { error, copied: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[maxcode] render error', error, info.componentStack)
  }

  private details() {
    const { error } = this.state
    return `${error?.name}: ${error?.message}\n\n${error?.stack ?? ''}`
  }

  private copy = async () => {
    try {
      await navigator.clipboard.writeText(this.details())
      this.setState({ copied: true })
    } catch {
      // Clipboard can be blocked; the details stay visible below.
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-dvh items-center justify-center bg-panel px-5 text-ink">
        <div className="w-full max-w-[460px]">
          <LogoMark size={34} />
          <h1 className="mt-4 font-display text-[28px] font-normal tracking-[-0.02em]">Something broke on this screen</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            Your conversations are saved on this computer. Try the screen again, or reload the app.
          </p>
          <pre className="thin-scroll mt-4 max-h-40 overflow-auto rounded-xl border border-line bg-canvas p-3 font-mono text-[11.5px] leading-relaxed text-muted">
            {this.state.error.message}
          </pre>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13px] font-medium text-on-accent transition hover:brightness-110"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-9 items-center rounded-full border border-line px-4 text-[13px] font-medium text-ink transition-colors hover:bg-raised"
            >
              Reload app
            </button>
            <button
              type="button"
              onClick={() => void this.copy()}
              className="inline-flex h-9 items-center rounded-full px-3 text-[13px] text-muted transition-colors hover:text-ink"
            >
              {this.state.copied ? 'Copied' : 'Copy details'}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
