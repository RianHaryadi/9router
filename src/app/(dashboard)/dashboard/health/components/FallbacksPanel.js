"use client";
import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import { date } from "./helpers";
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
              className="rounded-md bg-primary px-3 py-1 text-sm text-white"
              onClick={load}
            >
              Refresh
            </button>
          }
        >
          {/* Filters */}
          <div className="mb-4 grid gap-2 sm:grid-cols-4">
            <input
              aria-label="Filter by provider"
              value={filter.provider}
              onChange={(e) => updateFilter("provider", e.target.value)}
              placeholder="provider"
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm"
            />
            <input
              aria-label="Filter by model"
              value={filter.model}
              onChange={(e) => updateFilter("model", e.target.value)}
              placeholder="model"
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm"
            />
            <input
              aria-label="Filter by request ID"
              value={filter.requestId}
              onChange={(e) => updateFilter("requestId", e.target.value)}
              placeholder="request ID"
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm"
            />
            <input
              aria-label="Filter by since (ISO date)"
              type="date"
              value={filter.since}
              onChange={(e) => updateFilter("since", e.target.value)}
              placeholder="since"
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="p-2" scope="col">Time / request</th>
                  <th className="p-2" scope="col">Provider / model</th>
                  <th className="p-2" scope="col">From</th>
                  <th className="p-2" scope="col">Status</th>
                  <th className="p-2" scope="col">Reason</th>
                  <th className="p-2" scope="col">Cooldown</th>
                  <th className="p-2" scope="col">Latency</th>
                </tr>
              </thead>
              <tbody>
                {events.map((row, i) => (
                  <tr key={`${row.requestId}-${i}`} className="border-b border-border/60">
                    <td className="p-2">
                      <div>{date(row.timestamp)}</div>
                      <div className="text-xs text-text-muted">{row.requestId}</div>
                    </td>
                    <td>{row.provider}/{row.model}</td>
                    <td>{row.fromProvider}/{row.fromModel}</td>
                    <td>{row.status ?? "—"}</td>
                    <td>{row.reason ?? "—"}</td>
                    <td>{row.cooldownMs ?? 0} ms</td>
                    <td>{row.latencyMs != null ? `${row.latencyMs} ms` : "—"}</td>
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
                <h4 className="mb-2 font-semibold">By provider</h4>
                {Object.entries(data.summary.byProvider || {}).map(([key, value]) => (
                  <div key={key} className="flex justify-between border-b border-border/60 py-2 text-sm">
                    <span>{key}</span>
                    <span className="text-text-muted">{value}</span>
                  </div>
                ))}
                {!Object.keys(data.summary.byProvider || {}).length && (
                  <p className="text-sm text-text-muted">—</p>
                )}
              </div>
              <div>
                <h4 className="mb-2 font-semibold">By reason</h4>
                {Object.entries(data.summary.byReason || {}).map(([key, value]) => (
                  <div key={key} className="flex justify-between border-b border-border/60 py-2 text-sm">
                    <span>{key}</span>
                    <span className="text-text-muted">{value}</span>
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
