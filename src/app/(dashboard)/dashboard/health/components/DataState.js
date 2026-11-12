/**
 * DataState — loading spinner, error message, empty message, or children.
 * Renders role="status"/"alert" for assistive tech (T5 acceptance #5).
 * Kept OUT of helpers.js so helpers stays pure JS (test-importable).
 */
export function DataState({ loading, error, empty, children }) {
  if (loading) {
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center py-12 text-text-muted">
        <span className="material-symbols-outlined text-[32px] animate-spin">progress_activity</span>
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-6 text-center text-sm text-danger">
        Failed to load data. Please try again.
      </div>
    );
  }
  if (empty) {
    return (
      <div role="status" aria-live="polite" className="rounded-lg border border-border-subtle bg-surface p-6 text-center text-sm text-text-muted">
        No data available.
      </div>
    );
  }
  return children;
}
