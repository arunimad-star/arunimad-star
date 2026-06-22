import '../styles/globals.css'
import React from 'react'

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(err) { return { error: err } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', background: '#fff1f2', minHeight: '100vh' }}>
          <div style={{ fontWeight: 700, color: '#be123c', fontSize: '1.1rem', marginBottom: 12 }}>
            Render Error
          </div>
          <div style={{ color: '#7f1d1d', marginBottom: 12 }}>{this.state.error.message}</div>
          <pre style={{ fontSize: '0.75rem', color: '#991b1b', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 500, overflow: 'auto', background: '#fee2e2', padding: 12, borderRadius: 6 }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '6px 16px', cursor: 'pointer' }}
          >
            Dismiss
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App({ Component, pageProps }) {
  return (
    <AppErrorBoundary>
      <Component {...pageProps} />
    </AppErrorBoundary>
  )
}
