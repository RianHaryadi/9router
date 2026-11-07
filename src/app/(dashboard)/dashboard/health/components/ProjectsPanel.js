"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Card from "@/shared/components/Card";
import { money } from "./helpers";
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
        <Card title="Project ledger">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="p-2" scope="col">Project</th>
                  <th className="p-2" scope="col">Cost</th>
                  <th className="p-2" scope="col">Requests</th>
                  <th className="p-2" scope="col">Prompt tokens</th>
                  <th className="p-2" scope="col">Completion tokens</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.project} className="border-b border-border/60">
                    <td className="p-2">{row.project}</td>
                    <td>{money(row.cost)}</td>
                    <td>{row.requests ?? 0}</td>
                    <td>{row.promptTokens ?? 0}</td>
                    <td>{row.completionTokens ?? 0}</td>
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
