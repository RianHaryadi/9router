"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import { date, ms, num, rowClass, stateVariant, tableClass, tdClass, thClass } from "./helpers";
import { DataState } from "./DataState";

export default function HealthPanel() {
  const [data, setData] = useState(null); const [error, setError] = useState(false);
  useEffect(() => { fetch("/api/health/breaker", { cache: "no-store" }).then((r) => { if (!r.ok) throw Error(); return r.json(); }).then(setData).catch(() => setError(true)); }, []);
  const entries = data?.snapshot?.entries || [];
  return (
    <DataState loading={!data && !error} error={error} empty={data && !entries.length}>
      <Card title="Circuit breakers" subtitle={`${entries.length} tracked connection/model states`} padding="none">
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead className="bg-bg-alt">
              <tr>
                <th className={thClass} scope="col">Provider / model</th>
                <th className={thClass} scope="col">Connection</th>
                <th className={thClass} scope="col">State</th>
                <th className={`${thClass} text-right`} scope="col">Failures</th>
                <th className={thClass} scope="col">Blocked until</th>
                <th className={`${thClass} text-right`} scope="col">Cooldown</th>
                <th className={`${thClass} text-right`} scope="col">Latency</th>
                <th className={thClass} scope="col">Last error</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row, i) => (
                <tr key={`${row.connectionId}-${row.model}-${i}`} className={rowClass}>
                  <td className={tdClass}>
                    <div className="font-medium text-text-main">{row.provider || "—"}</div>
                    <div className="font-mono text-[11px] text-text-muted">{row.model || "—"}</div>
                  </td>
                  <td className={`${tdClass} font-mono text-[11px]`}>{row.connectionId || "aggregate"}</td>
                  <td className={tdClass}><Badge variant={stateVariant(row.state)} dot>{row.state}</Badge></td>
                  <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(row.consecutiveFailures)}</td>
                  <td className={`${tdClass} whitespace-nowrap text-[11px] text-text-muted`}>{date(row.blockedUntil)}</td>
                  <td className={`${tdClass} text-right font-mono tabular-nums`}>{ms(row.cooldownMs)}</td>
                  <td className={`${tdClass} text-right font-mono tabular-nums`}>{ms(row.avgLatencyMs)}</td>
                  <td className={`${tdClass} max-w-48 truncate text-[11px] text-text-muted`} title={row.lastError || ""}>{row.lastError || row.lastStatus || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </DataState>
  );
}
