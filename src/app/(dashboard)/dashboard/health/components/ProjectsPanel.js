"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Card from "@/shared/components/Card";
import { money, num, rowClass, tableClass, tdClass, thClass } from "./helpers";
import { DataState } from "./DataState";

const ProjectsChart = dynamic(() => import("./ProjectsChart"), { ssr: false });

export default function ProjectsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/api/usage/projects", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, []);
  const rows = data?.projects || [];
  return (
    <DataState loading={!data && !error} error={error} empty={data && !rows.length}>
      <div className="space-y-4">
        <Card title="Spend by project">
          <ProjectsChart data={rows} money={money} />
        </Card>
        <Card title="Project ledger" padding="none">
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="bg-bg-alt">
                <tr>
                  <th className={thClass} scope="col">Project</th>
                  <th className={`${thClass} text-right`} scope="col">Cost</th>
                  <th className={`${thClass} text-right`} scope="col">Requests</th>
                  <th className={`${thClass} text-right`} scope="col">Prompt tokens</th>
                  <th className={`${thClass} text-right`} scope="col">Completion tokens</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.project} className={rowClass}>
                    <td className={`${tdClass} font-medium text-text-main`}>{row.project}</td>
                    <td className={`${tdClass} text-right font-mono tabular-nums`}>{money(row.cost)}</td>
                    <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(row.requests)}</td>
                    <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(row.promptTokens)}</td>
                    <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(row.completionTokens)}</td>
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
