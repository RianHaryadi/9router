"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";

// Small local formatters — the health dashboard has its own copies, but
// importing across dashboards would tie the Usage page to the Health page.
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString());
const money = (v) => `$${Number(v || 0).toFixed(4)}`;
const date = (v) => (v ? new Date(v).toLocaleString() : "—");
const tableClass = "w-full text-left text-[12px]";
const thClass = "px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-bg bg-ink border-b-2 border-ink whitespace-nowrap";
const tdClass = "px-2 py-1.5 align-top";
const rowClass = "border-b border-ink/15 hover:bg-brand-50 transition-colors";

/**
 * Fork: spend per task.
 *
 * The client names the task it is working on (x-task-id header, or
 * metadata.taskId in the body) and every usage row of that task carries the
 * label. This panel answers "what did this agent run cost me?".
 *
 * Rows without a task roll into "unassigned".
 */
export default function TasksPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/usage/tasks", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const rows = data?.tasks || [];

  if (error) {
    return (
      <div role="alert" className="rounded-[12px] border-2 border-ink bg-danger p-6 text-center text-sm font-bold text-white shadow-[3px_3px_0_0_var(--color-shadow)]">
        Failed to load task spend. Please try again.
      </div>
    );
  }

  if (!data) {
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center py-12 text-text-main">
        <span className="material-symbols-outlined text-[32px] animate-spin">progress_activity</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div role="status" aria-live="polite" className="rounded-[12px] border-2 border-ink bg-surface p-6 text-center text-sm font-bold text-text-muted shadow-[3px_3px_0_0_var(--color-shadow)]">
        No task spend recorded yet. Send an <code>x-task-id</code> header to attribute a request to a task.
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card
        title="Spend per task"
        subtitle={`${rows.length} task(s) — ${money(data?.total?.cost)} across ${num(data?.total?.requests)} request(s)`}
        padding="none"
      >
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead className="bg-bg-alt">
              <tr>
                <th className={thClass} scope="col">Task</th>
                <th className={`${thClass} text-right`} scope="col">Cost</th>
                <th className={`${thClass} text-right`} scope="col">Requests</th>
                <th className={`${thClass} text-right`} scope="col">Prompt</th>
                <th className={`${thClass} text-right`} scope="col">Completion</th>
                <th className={thClass} scope="col">First seen</th>
                <th className={thClass} scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row?.task} className={rowClass}>
                  <td className={`${tdClass} font-mono text-[11px] max-w-64 truncate`} title={row?.task}>
                    {row?.task}
                  </td>
                  <td className={`${tdClass} text-right font-mono tabular-nums`}>{money(row?.cost)}</td>
                  <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(row?.requests)}</td>
                  <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(row?.promptTokens)}</td>
                  <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(row?.completionTokens)}</td>
                  <td className={`${tdClass} text-[11px] text-text-muted whitespace-nowrap`}>{date(row?.firstSeen)}</td>
                  <td className={`${tdClass} text-[11px] text-text-muted whitespace-nowrap`}>{date(row?.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
