import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

/** Keeps one broken screen from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Screen crashed:', error, info.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto text-brand-600" size={36} />
          <h1 className="text-xl font-extrabold mt-3">Something went wrong on this screen</h1>
          <p className="text-sm text-ink-soft mt-1.5">Your data is safe. Reload the page, or go back to the home screen.</p>
          <div className="mt-5 flex justify-center gap-2">
            <button className="min-h-11 px-4 rounded-xl bg-brand-500 text-white font-semibold" onClick={() => window.location.reload()}>Reload</button>
            <a className="min-h-11 px-4 rounded-xl border border-line bg-white font-semibold inline-flex items-center" href="/">Home</a>
          </div>
        </div>
      </div>
    )
  }
}
