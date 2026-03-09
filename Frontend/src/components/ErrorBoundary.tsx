import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: 'center', maxWidth: 480, margin: '40px auto', backgroundColor: '#f9f9f9', minHeight: '200px', border: '1px solid #ddd', borderRadius: 8 }}>
          <p style={{ color: '#c00', marginBottom: 16, fontWeight: 600 }}>Произошла ошибка при загрузке.</p>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 20 }}>{this.state.error?.message}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/login" style={{ color: '#1a73e8' }}>Вход</Link>
            <Link to="/profile" style={{ color: '#1a73e8' }}>Кабинет</Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
