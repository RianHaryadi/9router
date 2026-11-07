"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import { date, stateVariant } from "./helpers";
import { DataState } from "./DataState";

export default function HealthPanel() {
  const [data, setData] = useState(null); const [error, setError] = useState(false);
  useEffect(() => { fetch("/api/health/breaker", { cache: "no-store" }).then((r) => { if (!r.ok) throw Error(); return r.json(); }).then(setData).catch(() => setError(true)); }, []);
  const entries = data?.snapshot?.entries || [];
  return <DataState loading={!data && !error} error={error} empty={data && !entries.length}><Card title="Circuit breakers" subtitle={`${entries.length} tracked connection/model states`}>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-text-muted"><th className="p-2" scope="col">Provider / model</th><th scope="col">Connection</th><th scope="col">State</th><th scope="col">Failures</th><th scope="col">Blocked until</th><th scope="col">Cooldown</th><th scope="col">Latency</th><th scope="col">Last error</th></tr></thead>
      <tbody>{entries.map((row, i) => <tr key={`${row.connectionId}-${row.model}-${i}`} className="border-b border-border/60"><td className="p-2"><div>{row.provider || "—"}</div><div className="text-xs text-text-muted">{row.model || "—"}</div></td><td>{row.connectionId || "aggregate"}</td><td><Badge variant={stateVariant(row.state)} dot>{row.state}</Badge></td><td>{row.consecutiveFailures ?? 0}</td><td>{date(row.blockedUntil)}</td><td>{row.cooldownMs ?? 0} ms</td><td>{row.avgLatencyMs ?? "—"} ms</td><td className="max-w-48 truncate" title={row.lastError || ""}>{row.lastError || row.lastStatus || "—"}</td></tr>)}</tbody>
    </table>{!entries.length && <p className="p-6 text-center text-text-muted">No breaker activity.</p>}</div>
  </Card></DataState>;
}
