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
      <div role="alert" className="rounded-[14px] border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-500">
        Failed to load data. Please try again.
      </div>
    );
  }
  if (empty) {
    return (
      <div role="status" aria-live="polite" className="rounded-[14px] border border-border-subtle bg-surface p-6 text-center text-sm text-text-muted">
        No data available.
      </div>
    );
  }
  return children;
}
