"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import { date, ms, num, rowClass, stateVariant, tableClass, tdClass, thClass } from "./helpers";
import { DataState } from "./DataState";

/**
 * Fork (T5): the account matrix. The breaker tells you *that* a connection is
 * locked; the matrix tells you which accounts can serve a provider|model right
 * now, and which ones are down for a reason a human has to fix.
 */
export default function MatrixPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/api/health/matrix", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const matrix = data?.matrix;
  const accounts = matrix?.accounts || [];
  const providers = data?.providers || [];
  const summary = matrix?.summary || {};

  return (
    <DataState loading={!data && !error} error={error} empty={data && !accounts.length && !providers.length}>
      <div className="flex min-w-0 flex-col gap-4">
        {providers.length > 0 && (
          <Card title="Per provider" subtitle={`${providers.length} provider(s) with tracked accounts`} padding="none">
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className="bg-bg-alt">
                  <tr>
                    <th className={thClass} scope="col">Provider</th>
                    <th className={`${thClass} text-right`} scope="col">Accounts</th>
                    <th className={`${thClass} text-right`} scope="col">Healthy</th>
                    <th className={`${thClass} text-right`} scope="col">Open</th>
                    <th className={thClass} scope="col">Needs human</th>
                    <th className={thClass} scope="col">Models</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((row) => (
                    <tr key={row.provider} className={rowClass}>
                      <td className={`${tdClass} font-medium text-text-main`}>{row.provider}</td>
                      <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(row.total)}</td>
                      <td className={`${tdClass} text-right font-mono tabular-nums text-success`}>{num(row.healthy)}</td>
                      <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(row.open)}</td>
                      <td className={tdClass}>
                        {row.needsHuman > 0
                          ? <Badge variant="error" dot>{row.needsHuman} needs human</Badge>
                          : <span className="text-text-subtle">—</span>}
                      </td>
                      <td className={`${tdClass} max-w-72 truncate text-text-muted`} title={row.models.join(", ")}>
                        {row.models.join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {accounts.length > 0 && (
          <Card
            title="Account matrix"
            subtitle={`${summary.healthy ?? 0}/${summary.total ?? 0} healthy — ${matrix?.recommendation?.reason || ""}`}
            padding="none"
          >
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className="bg-bg-alt">
                  <tr>
                    <th className={thClass} scope="col">Provider / model</th>
                    <th className={thClass} scope="col">Account</th>
                    <th className={thClass} scope="col">State</th>
                    <th className={thClass} scope="col">Healthy</th>
                    <th className={thClass} scope="col">Failure</th>
                    <th className={thClass} scope="col">Scope</th>
                    <th className={thClass} scope="col">Action</th>
                    <th className={thClass} scope="col">Blocked until</th>
                    <th className={`${thClass} text-right`} scope="col">Latency</th>
                    <th className={thClass} scope="col">Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((row, i) => (
                    <tr key={`${row.connectionId}-${row.model}-${i}`} className={rowClass}>
                      <td className={tdClass}>
                        <div className="font-medium text-text-main">{row.provider || "—"}</div>
                        <div className="text-[11px] text-text-muted font-mono">{row.model || "—"}</div>
                      </td>
                      <td className={`${tdClass} font-mono text-[11px]`}>{row.connectionId || "aggregate"}</td>
                      <td className={tdClass}><Badge variant={stateVariant(row.state)} dot>{row.state}</Badge></td>
                      <td className={tdClass}>
                        {row.healthy
                          ? <Badge variant="success" dot>yes</Badge>
                          : row.needsHuman
                            ? <Badge variant="error" dot>needs human</Badge>
                            : <Badge variant="warning" dot>no</Badge>}
                      </td>
                      <td className={`${tdClass} font-mono text-[11px]`}>{row.lastFailureKind || "—"}</td>
                      <td className={`${tdClass} text-[11px] text-text-muted`}>{row.lastFailureScope || "—"}</td>
                      <td className={`${tdClass} text-[11px] text-text-muted`}>{row.lastFailureAction || "—"}</td>
                      <td className={`${tdClass} text-[11px] text-text-muted whitespace-nowrap`}>{date(row.blockedUntil)}</td>
                      <td className={`${tdClass} text-right font-mono tabular-nums`}>{ms(row.avgLatencyMs)}</td>
                      <td className={`${tdClass} max-w-48 truncate text-[11px] text-text-muted`} title={row.lastError || ""}>{row.lastError || row.lastStatus || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </DataState>
  );
}
