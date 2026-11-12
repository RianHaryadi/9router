"use client";
import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import { date, ms, num, rowClass, tableClass, tdClass, thClass } from "./helpers";
import { DataState } from "./DataState";

export default function FallbacksPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState({
    provider: "",
    model: "",
    requestId: "",
    since: "",
  });

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: "100" });
    Object.entries(filter).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    fetch(`/api/usage/fallbacks?${params}`)
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const events = data?.events || [];

  const updateFilter = (key, value) => setFilter((prev) => ({ ...prev, [key]: value }));

  return (
    <DataState loading={!data && !error} error={error} empty={data && !events.length}>
      <div className="space-y-4">
        <Card
          title="Fallback chain"
          action={
            <button
              className="rounded-md border border-primary bg-primary px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-white hover:bg-primary-hover transition-colors"
              onClick={load}
            >
              Refresh
            </button>
          }
        >
          {/* Filters */}
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <input
              aria-label="Filter by provider"
              value={filter.provider}
              onChange={(e) => updateFilter("provider", e.target.value)}
              placeholder="provider"
              className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-text-main placeholder:text-text-subtle focus:outline-none focus:border-primary"
            />
            <input
              aria-label="Filter by model"
              value={filter.model}
              onChange={(e) => updateFilter("model", e.target.value)}
              placeholder="model"
              className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-text-main placeholder:text-text-subtle focus:outline-none focus:border-primary"
            />
            <input
              aria-label="Filter by request ID"
              value={filter.requestId}
              onChange={(e) => updateFilter("requestId", e.target.value)}
              placeholder="request ID"
              className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-text-main placeholder:text-text-subtle focus:outline-none focus:border-primary"
            />
            <input
              aria-label="Filter by since (ISO date)"
              type="date"
              value={filter.since}
              onChange={(e) => updateFilter("since", e.target.value)}
              placeholder="since"
              className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-text-main placeholder:text-text-subtle focus:outline-none focus:border-primary"
            />
          </div>

          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="bg-bg-alt">
                <tr>
                  <th className={thClass} scope="col">Time / request</th>
                  <th className={thClass} scope="col">Provider / model</th>
                  <th className={thClass} scope="col">From</th>
                  <th className={thClass} scope="col">Status</th>
                  <th className={thClass} scope="col">Reason</th>
                  <th className={`${thClass} text-right`} scope="col">Cooldown</th>
                  <th className={`${thClass} text-right`} scope="col">Latency</th>
                </tr>
              </thead>
              <tbody>
                {events.map((row, i) => (
                  <tr key={`${row.requestId}-${i}`} className={rowClass}>
                    <td className={tdClass}>
                      <div className="whitespace-nowrap text-text-main">{date(row.timestamp)}</div>
                      <div className="font-mono text-[10px] text-text-subtle">{row.requestId}</div>
                    </td>
                    <td className={`${tdClass} font-medium text-text-main`}>{row.provider}/{row.model}</td>
                    <td className={`${tdClass} text-text-muted`}>{row.fromProvider}/{row.fromModel}</td>
                    <td className={`${tdClass} font-mono text-[11px]`}>{row.status ?? "—"}</td>
                    <td className={`${tdClass} text-[11px] text-text-muted`}>{row.reason ?? "—"}</td>
                    <td className={`${tdClass} text-right font-mono tabular-nums`}>{ms(row.cooldownMs)}</td>
                    <td className={`${tdClass} text-right font-mono tabular-nums`}>{ms(row.latencyMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!events.length && (
              <p className="p-6 text-center text-text-muted">No fallback events.</p>
            )}
          </div>
        </Card>

        {/* Summary */}
        {data?.summary && (
          <Card title="Summary">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">By provider</h4>
                {Object.entries(data.summary.byProvider || {}).map(([key, value]) => (
                  <div key={key} className="flex justify-between border-b border-border-subtle py-1.5 text-[12px]">
                    <span className="text-text-main">{key}</span>
                    <span className="font-mono tabular-nums text-text-muted">{num(value)}</span>
                  </div>
                ))}
                {!Object.keys(data.summary.byProvider || {}).length && (
                  <p className="text-sm text-text-muted">—</p>
                )}
              </div>
              <div>
                <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">By reason</h4>
                {Object.entries(data.summary.byReason || {}).map(([key, value]) => (
                  <div key={key} className="flex justify-between border-b border-border-subtle py-1.5 text-[12px]">
                    <span className="text-text-main">{key}</span>
                    <span className="font-mono tabular-nums text-text-muted">{num(value)}</span>
                  </div>
                ))}
                {!Object.keys(data.summary.byReason || {}).length && (
                  <p className="text-sm text-text-muted">—</p>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
    </DataState>
  );
}
