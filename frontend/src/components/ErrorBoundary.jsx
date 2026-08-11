import { Component } from 'react';

/**
 * Catches render errors anywhere below it and shows what went wrong.
 *
 * Without this, a single bad value unmounts the entire React tree and leaves a
 * blank white page with no message — you have to open the browser console to
 * learn anything. That is exactly what happened when the OCR adapter passed an
 * array of objects into JSX: the app went white and gave no clue why.
 *
 * Must be a class component. React has no hook equivalent of componentDidCatch.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  // Runs when a descendant throws during render — swaps in the fallback UI.
  static getDerivedStateFromError(error) {
    return { error };
  }

  // Runs after, with the component stack. Useful for logging.
  componentDidCatch(error, info) {
    console.error('Render error caught by ErrorBoundary:', error, info);
    this.setState({ info });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-full bg-slate-50 p-8 font-sans">
        <div className="max-w-3xl mx-auto bg-white border border-red-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-red-600 text-white px-5 py-3">
            <h1 className="font-bold text-sm">Something broke while rendering this screen</h1>
            <p className="text-red-100 text-xs mt-0.5">
              The rest of the app is fine — this panel replaced the crash so you can see the cause.
            </p>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Error</div>
              <pre className="bg-slate-900 text-red-300 text-xs p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                {error.toString()}
              </pre>
            </div>

            {info?.componentStack && (
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Where</div>
                <pre className="bg-slate-100 text-slate-700 text-[10px] p-3 rounded-lg overflow-x-auto max-h-56">
                  {info.componentStack.trim()}
                </pre>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => window.location.reload()}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition"
              >
                Reload the page
              </button>
              <span className="text-[11px] text-slate-500">
                Full details are in the browser console (F12).
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
