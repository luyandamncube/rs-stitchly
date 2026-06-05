import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    if (!import.meta.env.DEV) {
      return null;
    }

    return (
      <main style={{ color: '#241f21', font: '14px/1.5 system-ui, sans-serif', padding: 32 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>Stitchly failed to start</h1>
        <pre
          style={{
            background: '#f6eeee',
            border: '1px solid #e3c5c5',
            padding: 16,
            whiteSpace: 'pre-wrap'
          }}
        >
          {this.state.error?.stack ?? this.state.error?.message ?? String(this.state.error)}
        </pre>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
