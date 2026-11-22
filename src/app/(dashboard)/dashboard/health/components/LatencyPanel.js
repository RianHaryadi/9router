"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Card from "@/shared/components/Card";
import { formatPercentile, money, num, rowClass, tableClass, tdClass, thClass } from "./helpers";
import { DataState } from "./DataState";

const LatencyChart = dynamic(() => import("./LatencyChart"), { ssr: false });

function Stats({ label, values }) {
  return (
    <Card title={label} padding="sm">
      <div className="grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
        {["p50", "p90", "p95", "p99", "min", "max", "avg"].map((key) => (
          <div key={key}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle">{key}</div>
            <div className="font-mono tabular-nums text-text-main">{formatPercentile(values?.[key])}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function LatencyPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/usage/latency", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const chart = ["p50", "p90", "p95", "p99"].map((key) => ({
    name: key,
    latency: data?.latencyMs?.[key] || 0,
    ttft: data?.ttftMs?.[key] || 0,
  }));

  return (
    <DataState loading={!data && !error} error={error}>
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Stats label="Latency (ms)" values={data?.latencyMs} />
          <Stats label="TTFT (ms)" values={data?.ttftMs} />
        </div>
        <Card title="Percentiles">
          <LatencyChart data={chart} />
        </Card>
        <Card title="Provider health" padding="none">
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="bg-bg-alt">
                <tr>
                  <th className={thClass} scope="col">Provider</th>
                  <th className={`${thClass} text-right`} scope="col">Requests</th>
                  <th className={`${thClass} text-right`} scope="col">Cost</th>
                  <th className={`${thClass} text-right`} scope="col">Avg latency</th>
                  <th className={`${thClass} text-right`} scope="col">Avg TTFT</th>
                  <th className={`${thClass} text-right`} scope="col">Errors</th>
                </tr>
              </thead>
              <tbody>
                {(data?.providers || []).map((row) => (
                  <tr key={row.provider} className={rowClass}>
                    <td className={`${tdClass} font-medium text-text-main`}>{row.provider}</td>
                    <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(row.requests)}</td>
                    <td className={`${tdClass} text-right font-mono tabular-nums`}>{money(row.cost)}</td>
                    <td className={`${tdClass} text-right font-mono tabular-nums`}>{formatPercentile(row.avgLatency ?? row.avgLatencyMs)}</td>
                    <td className={`${tdClass} text-right font-mono tabular-nums`}>{formatPercentile(row.avgTtft ?? row.avgTtftMs)}</td>
                    <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(row.errors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </DataState>
  );
}
