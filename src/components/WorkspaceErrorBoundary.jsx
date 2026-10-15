import { Component } from 'react'

class WorkspaceErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Workspace crashed:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center bg-sf-dark-950 px-6">
          <div className="max-w-md rounded-2xl border border-red-500/25 bg-sf-dark-900 px-6 py-5 text-center shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <div className="text-sm font-semibold text-red-200">Workspace failed to load</div>
            <p className="mt-2 text-sm text-sf-text-muted">
              This tab hit a runtime error, but the rest of the app is still safe. Switch away and back to retry.
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default WorkspaceErrorBoundary
