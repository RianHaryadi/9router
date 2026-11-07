"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import Card from "@/shared/components/Card";
import { formatPercentile, money, DataState } from "./helpers";

function Stats({ label, values }) { return <Card title={label} padding="sm"><div className="grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">{["p50", "p90", "p95", "p99", "min", "max", "avg"].map((key) => <div key={key}><div className="text-xs text-text-muted">{key}</div><div className="font-semibold">{formatPercentile(values?.[key])}</div></div>)}</div></Card>; }

export default function LatencyPanel() {
  const [data, setData] = useState(null); const [error, setError] = useState(false);
  useEffect(() => { fetch("/api/usage/latency", { cache: "no-store" }).then((r) => { if (!r.ok) throw Error(); return r.json(); }).then(setData).catch(() => setError(true)); }, []);
  const chart = ["p50", "p90", "p95", "p99"].map((key) => ({ name: key, latency: data?.latencyMs?.[key] || 0, ttft: data?.ttftMs?.[key] || 0 }));
  return <DataState loading={!data && !error} error={error}><div className="space-y-4"><div className="grid gap-4 md:grid-cols-2"><Stats label="Latency (ms)" values={data?.latencyMs} /><Stats label="TTFT (ms)" values={data?.ttftMs} /></div><Card title="Percentiles"><ResponsiveContainer width="100%" height={240}><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="latency" fill="#6366f1" name="Latency" /><Bar dataKey="ttft" fill="#14b8a6" name="TTFT" /></BarChart></ResponsiveContainer></Card><Card title="Provider health"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-text-muted"><th className="p-2">Provider</th><th>Requests</th><th>Cost</th><th>Avg latency</th><th>Avg TTFT</th><th>Errors</th></tr></thead><tbody>{(data?.providers || []).map((row) => <tr key={`${row.provider}-${row.model}`} className="border-b border-border/60"><td className="p-2">{row.provider}<div className="text-xs text-text-muted">{row.model}</div></td><td>{row.requests ?? 0}</td><td>{money(row.cost)}</td><td>{formatPercentile(row.avgLatency ?? row.avgLatencyMs)}</td><td>{formatPercentile(row.avgTtft ?? row.avgTtftMs)}</td><td>{row.errors ?? 0}</td></tr>)}</tbody></table></div></Card></div></DataState>;
}
