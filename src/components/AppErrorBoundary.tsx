import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Dokimi workspace render failed.', { error: error.message, componentStack: info.componentStack });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="route-error" role="alert">
        <p>WORKSPACE RECOVERY</p>
        <h1>This view could not be rendered.</h1>
        <span>Your locally saved research has not been deleted.</span>
        <button type="button" onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </main>
    );
  }
}
