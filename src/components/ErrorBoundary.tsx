import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center border border-red-100">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <ShieldAlert className="text-red-500 w-10 h-10" />
            </div>
            
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Oups ! Un problème est survenu.</h1>
            <p className="text-slate-500 mb-6">
              L'application a rencontré une erreur inattendue. Nos systèmes de sécurité ont bloqué le processus pour protéger vos données.
            </p>
            
            <div className="bg-slate-100 p-3 rounded-lg text-left mb-6 overflow-hidden">
                <p className="text-xs font-mono text-slate-600 break-words">
                    {this.state.error?.toString()}
                </p>
            </div>

            <button 
                onClick={this.handleReload}
                className="w-full py-3 bg-slate-900 hover:bg-black text-white rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 transition-all"
            >
                <RefreshCw size={18} /> Recharger l'application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;