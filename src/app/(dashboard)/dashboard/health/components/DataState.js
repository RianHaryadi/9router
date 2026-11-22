/**
 * DataState — loading spinner, error message, empty message, or children.
 * Renders role="status"/"alert" for assistive tech (T5 acceptance #5).
 * Kept OUT of helpers.js so helpers stays pure JS (test-importable).
 */
export function DataState({ loading, error, empty, children }) {
  if (loading) {
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center py-12 text-text-main">
        <span className="material-symbols-outlined text-[32px] animate-spin">progress_activity</span>
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="rounded-[12px] border-2 border-ink bg-danger p-6 text-center text-sm font-bold text-white shadow-[3px_3px_0_0_var(--color-shadow)]">
        Failed to load data. Please try again.
      </div>
    );
  }
  if (empty) {
    return (
      <div role="status" aria-live="polite" className="rounded-[12px] border-2 border-ink bg-surface p-6 text-center text-sm font-bold text-text-muted shadow-[3px_3px_0_0_var(--color-shadow)]">
        No data available.
      </div>
    );
  }
  return children;
}
