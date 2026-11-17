"use client";

// Owner-only management of the teammates who may use Basic Chat.
//
// A teammate signs in with the PASSWORD the owner gave them — one field, no
// username, no API key to copy around. The key that bills their requests
// stays server-side, so a leaked member password grants chat access and
// nothing else: it cannot be replayed against /v1 as a bearer token.
//
// The key's own allow-list, budget and rate limits decide what the teammate
// can reach, so assign them a key from Endpoint & Key.

import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import { MEMBER_AREAS, MEMBER_BASE_AREAS } from "@/shared/constants/memberAreas";

export default function TeamMembersCard() {
  const [members, setMembers] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", password: "", apiKeyRef: "", areas: [] });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [membersRes, keysRes] = await Promise.all([
        fetch("/api/team/members", { cache: "no-store" }),
        fetch("/api/keys", { cache: "no-store" }),
      ]);
      const membersData = await membersRes.json().catch(() => ({}));
      const keysData = await keysRes.json().catch(() => ({}));
      if (!membersRes.ok) throw new Error(membersData.error || "Failed to load teammates");
      setMembers(membersData.members || []);
      setApiKeys(keysData.keys || []);
    } catch (e) {
      setError(e.message || "Failed to load teammates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/team/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          password: form.password,
          apiKeyRef: form.apiKeyRef || undefined,
          areas: form.areas,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to add teammate");
      setForm({ name: "", password: "", apiKeyRef: "", areas: [] });
      load();
    } catch (e) {
      setError(e.message || "Failed to add teammate");
    }
  };

  const update = async (id, patch) => {
    setError("");
    try {
      const res = await fetch("/api/team/members", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update teammate");
      load();
    } catch (e) {
      setError(e.message || "Failed to update teammate");
    }
  };

  const remove = async (id) => {
    setError("");
    try {
      const res = await fetch(`/api/team/members?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to remove teammate");
      load();
    } catch (e) {
      setError(e.message || "Failed to remove teammate");
    }
  };

  const keyLabel = (ref) => {
    const key = apiKeys.find((k) => k.keyRef === ref);
    return key ? key.name : ref || "—";
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-brand-300/15 text-brand-700 dark:text-brand-300 shrink-0">
          <span className="material-symbols-outlined text-[20px]">group</span>
        </div>
        <h3 className="text-base sm:text-lg font-semibold">Teammates</h3>
      </div>

      <p className="text-xs sm:text-sm text-text-muted mb-4">
        Give a teammate a password. They sign in at the login page with that password alone — no
        username, no API key to copy — and land straight in Basic Chat. The key assigned below bills
        their requests and decides which models they may reach, so pick a restricted key from Endpoint
        &amp; Key.
      </p>

      {error && <p role="alert" className="text-xs text-danger mb-3">{error}</p>}

      <div className="flex flex-col gap-2">
        {members.length === 0 && (
          <p className="text-sm text-text-muted">{loading ? "Loading…" : "No teammates yet."}</p>
        )}
        {members.map((member) => (
          <div key={member.id} className="flex flex-col gap-2 rounded-lg border border-ink/10 p-3 dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium text-sm">{member.name}</span>
                {!member.isActive && <span className="ml-2 text-xs text-warning">disabled</span>}
                <p className="text-xs text-text-muted">Key: {keyLabel(member.apiKeyRef)}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => update(member.id, { isActive: !member.isActive })}>
                  {member.isActive ? "Disable" : "Enable"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(member.id)}>
                  Remove
                </Button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={member.apiKeyRef || ""}
                onChange={(e) => update(member.id, { apiKeyRef: e.target.value || null })}
                className="h-9 px-3 rounded-lg border border-ink/10 dark:border-white/10 bg-surface text-sm text-text-main"
                style={{ colorScheme: "auto" }}
              >
                <option value="">No key assigned</option>
                {apiKeys.map((k) => (
                  <option key={k.id} value={k.keyRef || ""}>
                    {k.name}
                  </option>
                ))}
              </select>
              <Input
                type="password"
                placeholder="New password (leave empty to keep)"
                onKeyDown={(e) => {
                  const value = e.currentTarget.value;
                  if (e.key === "Enter" && value) {
                    update(member.id, { password: value });
                    e.currentTarget.value = "";
                  }
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-text-muted">Can access</p>
              <div className="flex flex-wrap gap-2">
                {MEMBER_AREAS.map((area) => {
                  const locked = MEMBER_BASE_AREAS.includes(area.id);
                  const checked = locked || (member.areas || []).includes(area.id);
                  return (
                    <label
                      key={area.id}
                      title={area.hint}
                      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                        checked
                          ? "border-brand-600/40 bg-brand-300/25 text-text-main"
                          : "border-ink/10 text-text-muted dark:border-white/10"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked}
                        onChange={(e) => {
                          const current = member.areas || [];
                          const next = e.target.checked
                            ? [...current, area.id]
                            : current.filter((id) => id !== area.id);
                          update(member.id, { areas: next });
                        }}
                        className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
                      />
                      {area.label}
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-text-muted">
                Takes effect immediately — the teammate does not have to sign in again.
              </p>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={create} className="mt-4 flex flex-col gap-2 border-t border-ink/10 pt-4 dark:border-white/10">
        <p className="font-medium text-sm">Add a teammate</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            placeholder="Name (e.g. Andi)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <Input
            type="password"
            placeholder="Password for them"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </div>
        <select
          value={form.apiKeyRef}
          onChange={(e) => setForm({ ...form, apiKeyRef: e.target.value })}
          className="h-9 px-3 rounded-lg border border-ink/10 dark:border-white/10 bg-surface text-sm text-text-main"
          style={{ colorScheme: "auto" }}
        >
          <option value="">No key assigned</option>
          {apiKeys.map((k) => (
            <option key={k.id} value={k.keyRef || ""}>
              {k.name}
            </option>
          ))}
        </select>
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-text-muted">Can access</p>
          <div className="flex flex-wrap gap-2">
            {MEMBER_AREAS.map((area) => {
              const locked = MEMBER_BASE_AREAS.includes(area.id);
              const checked = locked || form.areas.includes(area.id);
              return (
                <label
                  key={area.id}
                  title={area.hint}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                    checked
                      ? "border-brand-600/40 bg-brand-300/25 text-text-main"
                      : "border-ink/10 text-text-muted dark:border-white/10"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...form.areas, area.id]
                        : form.areas.filter((id) => id !== area.id);
                      setForm({ ...form, areas: next });
                    }}
                    className="h-3.5 w-3.5 accent-[var(--color-brand-600)]"
                  />
                  {area.label}
                </label>
              );
            })}
          </div>
        </div>
        <Button type="submit" variant="primary" className="w-full sm:w-auto">
          Add teammate
        </Button>
      </form>
    </Card>
  );
}
