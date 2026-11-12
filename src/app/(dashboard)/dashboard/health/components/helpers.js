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
 * Neubrutalism: dense tables get right-aligned monospace numbers so columns
 * line up, with heavy black rules.
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

/** Shared class names for a data table in the Neubrutalism look. */
export const tableClass = "w-full text-left text-[12px]";
export const thClass = "px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-bg bg-ink border-b-2 border-ink whitespace-nowrap";
export const tdClass = "px-2 py-1.5 align-top";
export const numCellClass = `${tdClass} text-right font-mono tabular-nums text-text-main`;
export const rowClass = "border-b border-ink/15 hover:bg-brand-50 transition-colors";
