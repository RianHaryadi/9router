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

