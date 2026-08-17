import { Component, type ReactNode, type ErrorInfo } from 'react'
import { logger } from '@/lib/logger'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.errorObj('react.errorBoundary', 'render error caught', error, {
      componentStack: info.componentStack,
    })
  }

  render() {
    if (this.state.error) {
      return <div className="p-4 text-xs text-red-600 whitespace-pre-wrap">{this.state.error.message}</div>
    }
    return this.props.children
  }
}
