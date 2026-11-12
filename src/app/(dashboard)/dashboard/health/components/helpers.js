export function formatPercentile(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value))} ms`;
}

export function stateVariant(state) {
  return state === "closed" ? "success" : state === "half-open" ? "warning" : "error";
}

export function money(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

export function date(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

/**
 * Ops Console: dense tables get right-aligned monospace numbers so columns
 * line up and can be compared at a glance.
 */
export function num(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString();
}

export function ms(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Math.round(Number(value));
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}s` : `${n}ms`;
}

/** Shared class names for a data table in the Ops Console look. */
export const tableClass = "w-full text-left text-[12px]";
export const thClass = "px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle whitespace-nowrap";
export const tdClass = "px-2 py-1.5 align-top";
export const numCellClass = `${tdClass} text-right font-mono tabular-nums text-text-main`;
export const rowClass = "border-t border-border-subtle hover:bg-surface-2/60 transition-colors";
