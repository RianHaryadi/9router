"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Toggle from "@/shared/components/Toggle";
import { date, ms, num, rowClass, tableClass, tdClass, thClass } from "./helpers";
import { DataState } from "./DataState";

/** Persist the shadow settings. Returns the saved settings or null on failure. */
async function saveShadowSettings(payload) {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function ShadowSettings({ data, onSaved }) {
  const [enabled, setEnabled] = useState(data?.enabled === true);
  const [ratio, setRatio] = useState(String(Math.round((data?.ratio || 0) * 100)));
  const [targets, setTargets] = useState(
    (data?.targets || []).map((t) => ({
      provider: t?.provider || "",
      model: t?.model || "",
      weight: t?.weight ?? 1,
    }))
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const dirty =
    enabled !== (data?.enabled === true) ||
    Number(ratio) / 100 !== (data?.ratio || 0) ||
    JSON.stringify(targets) !== JSON.stringify(data?.targets || []);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveShadowSettings({
        shadowRoutingEnabled: enabled,
        shadowRoutingRatio: Math.min(1, Math.max(0, Number(ratio) / 100)),
        shadowRoutingTargets: targets
          .filter((t) => t.provider && t.model)
          .map((t) => ({ provider: t.provider, model: t.model, weight: Number(t.weight) || 1 })),
      });
      setMessage({ ok: true, text: "Saved." });
      onSaved?.(saved);
    } catch (e) {
      setMessage({ ok: false, text: e?.message || "Failed to save." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Shadow routing settings" subtitle="Compare a second provider on a sampled share of requests" padding="none">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-main">Enable shadow routing</p>
            <p className="text-xs text-text-muted">
              The shadow request runs after the primary answer is sent, so it never delays the user.
            </p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} disabled={busy} />
        </div>

        <Input
          label="Sample ratio (%)"
          type="number"
          min={0}
          max={100}
          value={ratio}
          disabled={busy}
          onChange={(e) => setRatio(e.target.value)}
          hint="How many requests are also sent to the shadow target. 0 disables sampling."
        />

        <div className="flex flex-col gap-2">
          <p className="text-[12px] font-bold uppercase tracking-wide text-text-main">Shadow targets</p>
          {targets.map((t, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Input
                label="Provider"
                value={t.provider}
                disabled={busy}
                onChange={(e) => setTargets((prev) => prev.map((x, j) => (j === i ? { ...x, provider: e.target.value } : x)))}
                className="flex-1 min-w-[120px]"
              />
              <Input
                label="Model"
                value={t.model}
                disabled={busy}
                onChange={(e) => setTargets((prev) => prev.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)))}
                className="flex-1 min-w-[120px]"
              />
              <Input
                label="Weight"
                type="number"
                min={0}
                value={t.weight}
                disabled={busy}
                onChange={(e) => setTargets((prev) => prev.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))}
                className="w-20"
              />
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setTargets((prev) => prev.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setTargets((prev) => [...prev, { provider: "", model: "", weight: 1 }])}
          >
            Add target
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {message && (
            <span className={`text-xs ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Fork: the shadow evaluation panel.
 *
 * Shadow routing sends a sampled share of requests to a second provider and
 * compares the two answers. This panel answers "is the shadow target worth
 * keeping?" — the match rate tells you whether the two providers agree.
 *
 * The answer text is never shown here: only the verdict, the models and the
 * latency.
 */
export default function ShadowPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const load = () => {
    fetch("/api/health/shadow", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  };
  useEffect(load, []);

  const stats = data?.stats || {};
  const recent = data?.recent || [];
  const targets = data?.targets || [];
  const enabled = data?.enabled === true;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ShadowSettings data={data} onSaved={load} />
      {error ? (
        <div role="alert" className="rounded-[12px] border-2 border-ink bg-danger p-6 text-center text-sm font-bold text-white shadow-[3px_3px_0_0_var(--color-shadow)]">
          Failed to load shadow data. Please try again.
        </div>
      ) : (
        <DataState loading={!data} empty={data && !recent.length && !targets.length}>
          <div className="flex min-w-0 flex-col gap-4">
        <Card
          title="Shadow routing"
          subtitle={enabled
            ? `On — ${Math.round((data?.ratio || 0) * 100)}% of requests are also sent to a shadow target`
            : "Off — enable it in Settings to compare two providers"}
          padding="none"
        >
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="bg-bg-alt">
                <tr>
                  <th className={thClass} scope="col">Metric</th>
                  <th className={`${thClass} text-right`} scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr className={rowClass}>
                  <td className={tdClass}>Shadow dispatches</td>
                  <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(stats.total)}</td>
                </tr>
                <tr className={rowClass}>
                  <td className={tdClass}>Compared</td>
                  <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(stats.compared)}</td>
                </tr>
                <tr className={rowClass}>
                  <td className={tdClass}>Identical answers</td>
                  <td className={`${tdClass} text-right font-mono tabular-nums`}>
                    {num(stats.matched)}
                    {stats.compared > 0 && (
                      <span className="ml-1 text-text-muted">
                        ({Math.round((stats.matchRate || 0) * 100)}%)
                      </span>
                    )}
                  </td>
                </tr>
                <tr className={rowClass}>
                  <td className={tdClass}>Errors</td>
                  <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(stats.errors)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        {targets.length > 0 && (
          <Card title="Shadow targets" subtitle={`${targets.length} configured`} padding="none">
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className="bg-bg-alt">
                  <tr>
                    <th className={thClass} scope="col">Provider</th>
                    <th className={thClass} scope="col">Model</th>
                    <th className={`${thClass} text-right`} scope="col">Weight</th>
                    <th className={`${thClass} text-right`} scope="col">Dispatches</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t, i) => {
                    const key = `${t?.provider}/${t?.model}`;
                    return (
                      <tr key={`${key}-${i}`} className={rowClass}>
                        <td className={tdClass}>{t?.provider || "—"}</td>
                        <td className={`${tdClass} font-mono text-[11px]`}>{t?.model || "—"}</td>
                        <td className={`${tdClass} text-right font-mono tabular-nums`}>{num(t?.weight ?? 1)}</td>
                        <td className={`${tdClass} text-right font-mono tabular-nums`}>
                          {num(stats.byTarget?.[key] ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {recent.length > 0 && (
          <Card title="Recent comparisons" subtitle={`${recent.length} most recent`} padding="none">
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className="bg-bg-alt">
                  <tr>
                    <th className={thClass} scope="col">When</th>
                    <th className={thClass} scope="col">Primary</th>
                    <th className={thClass} scope="col">Shadow</th>
                    <th className={thClass} scope="col">Verdict</th>
                    <th className={`${thClass} text-right`} scope="col">Similarity</th>
                    <th className={`${thClass} text-right`} scope="col">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row, i) => (
                    <tr key={`${row?.requestId}-${i}`} className={rowClass}>
                      <td className={`${tdClass} text-[11px] text-text-muted whitespace-nowrap`}>
                        {date(row?.at)}
                      </td>
                      <td className={`${tdClass} font-mono text-[11px]`}>
                        {row?.primary ? `${row.primary.provider}/${row.primary.model}` : "—"}
                      </td>
                      <td className={`${tdClass} font-mono text-[11px]`}>
                        {row?.shadow ? `${row.shadow.provider}/${row.shadow.model}` : "—"}
                      </td>
                      <td className={tdClass}>
                        {row?.error
                          ? <Badge variant="error" dot>error</Badge>
                          : row?.matched
                            ? <Badge variant="success" dot>identical</Badge>
                            : <Badge variant="warning" dot>differs</Badge>}
                      </td>
                      <td className={`${tdClass} text-right font-mono tabular-nums`}>
                        {row?.hasPrimaryText && row?.hasShadowText
                          ? `${Math.round((row?.similarity || 0) * 100)}%`
                          : "—"}
                      </td>
                      <td className={`${tdClass} text-right font-mono tabular-nums`}>{ms(row?.latencyMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
          </div>
        </DataState>
      )}
    </div>
  );
}
