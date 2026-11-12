"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import { date, stateVariant } from "./helpers";
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
      <div className="flex min-w-0 flex-col gap-6">
        {providers.length > 0 && (
          <Card title="Per provider" subtitle={`${providers.length} provider(s) with tracked accounts`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-text-muted">
                    <th className="p-2" scope="col">Provider</th>
                    <th scope="col">Accounts</th>
                    <th scope="col">Healthy</th>
                    <th scope="col">Open</th>
                    <th scope="col">Needs human</th>
                    <th scope="col">Models</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((row) => (
                    <tr key={row.provider} className="border-b border-border/60">
                      <td className="p-2">{row.provider}</td>
                      <td>{row.total}</td>
                      <td>{row.healthy}</td>
                      <td>{row.open}</td>
                      <td>{row.needsHuman > 0
                        ? <Badge variant="error" dot>{row.needsHuman} needs human</Badge>
                        : <span className="text-text-muted">—</span>}
                      </td>
                      <td className="max-w-72 truncate text-xs text-text-muted" title={row.models.join(", ")}>
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
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-text-muted">
                    <th className="p-2" scope="col">Provider / model</th>
                    <th scope="col">Account</th>
                    <th scope="col">State</th>
                    <th scope="col">Healthy</th>
                    <th scope="col">Failure</th>
                    <th scope="col">Scope</th>
                    <th scope="col">Action</th>
                    <th scope="col">Blocked until</th>
                    <th scope="col">Latency</th>
                    <th scope="col">Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((row, i) => (
                    <tr key={`${row.connectionId}-${row.model}-${i}`} className="border-b border-border/60">
                      <td className="p-2">
                        <div>{row.provider || "—"}</div>
                        <div className="text-xs text-text-muted">{row.model || "—"}</div>
                      </td>
                      <td>{row.connectionId || "aggregate"}</td>
                      <td><Badge variant={stateVariant(row.state)} dot>{row.state}</Badge></td>
                      <td>
                        {row.healthy
                          ? <Badge variant="success" dot>yes</Badge>
                          : row.needsHuman
                            ? <Badge variant="error" dot>needs human</Badge>
                            : <Badge variant="warning" dot>no</Badge>}
                      </td>
                      <td>{row.lastFailureKind || "—"}</td>
                      <td className="text-xs text-text-muted">{row.lastFailureScope || "—"}</td>
                      <td className="text-xs text-text-muted">{row.lastFailureAction || "—"}</td>
                      <td>{date(row.blockedUntil)}</td>
                      <td>{row.avgLatencyMs ?? "—"} ms</td>
                      <td className="max-w-48 truncate" title={row.lastError || ""}>{row.lastError || row.lastStatus || "—"}</td>
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
