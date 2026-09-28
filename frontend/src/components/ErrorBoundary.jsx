import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[IBVAP ErrorBoundary Caught]:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#07090e',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'monospace'
        }}>
          <div style={{
            maxWidth: '640px',
            width: '100%',
            backgroundColor: '#0d1117',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            padding: '24px',
            boxShadow: '0 0 20px rgba(239,68,68,0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={{ fontSize: '24px' }}>⚠️</span>
              <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#f87171', margin: 0 }}>
                IBVAP APPLICATION ERROR
              </h1>
            </div>

            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px', lineHeight: '1.5' }}>
              A runtime exception prevented the dashboard from rendering.
            </p>

            <div style={{
              backgroundColor: '#05070a',
              border: '1px solid #334155',
              borderRadius: '4px',
              padding: '12px',
              fontSize: '12px',
              color: '#fca5a5',
              overflowX: 'auto',
              marginBottom: '16px',
              whiteSpace: 'pre-wrap'
            }}>
              {this.state.error?.toString() || 'Unknown error occurred.'}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#06b6d4',
                  color: '#000',
                  border: 'none',
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                RELOAD PAGE
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#1e293b',
                  color: '#94a3b8',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                RESET CACHE & RELOAD
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
