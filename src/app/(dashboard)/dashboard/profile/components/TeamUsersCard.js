"use client";

// Owner-only management of the teammate accounts that may use Basic Chat.
//
// A teammate logs in with their own username + password and gets a chat box
// and nothing else: no keys, no providers, no usage, no settings. Their
// requests are billed to the API key assigned here, so that key's
// allow-list, budget and rate limits decide what they can reach.

import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";

export default function TeamUsersCard() {
  const [users, setUsers] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", password: "", displayName: "", apiKeyRef: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usersRes, keysRes] = await Promise.all([
        fetch("/api/dashboard/users", { cache: "no-store" }),
        fetch("/api/keys", { cache: "no-store" }),
      ]);
      const usersData = await usersRes.json().catch(() => ({}));
      const keysData = await keysRes.json().catch(() => ({}));
      if (!usersRes.ok) throw new Error(usersData.error || "Failed to load users");
      setUsers(usersData.users || []);
      setApiKeys(keysData.keys || []);
    } catch (e) {
      setError(e.message || "Failed to load users");
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
      const res = await fetch("/api/dashboard/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          displayName: form.displayName.trim() || undefined,
          apiKeyRef: form.apiKeyRef || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create user");
      setForm({ username: "", password: "", displayName: "", apiKeyRef: "" });
      load();
    } catch (e) {
      setError(e.message || "Failed to create user");
    }
  };

  const update = async (id, patch) => {
    setError("");
    try {
      const res = await fetch("/api/dashboard/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update user");
      load();
    } catch (e) {
      setError(e.message || "Failed to update user");
    }
  };

  const remove = async (id) => {
    setError("");
    try {
      const res = await fetch(`/api/dashboard/users?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to remove user");
      load();
    } catch (e) {
      setError(e.message || "Failed to remove user");
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
        A teammate logs in with their own username and password and gets a chat box only — no keys, no
        providers, no usage, no settings. Their requests are billed to the API key assigned to them, so that
        key&apos;s allow-list, budget and rate limits decide what they can reach. Assign a key from
        Endpoint &amp; Key.
      </p>

      {error && <p role="alert" className="text-xs text-danger mb-3">{error}</p>}

      <div className="flex flex-col gap-2">
        {users.length === 0 && (
          <p className="text-sm text-text-muted">{loading ? "Loading…" : "No teammates yet."}</p>
        )}
        {users.map((user) => (
          <div key={user.id} className="flex flex-col gap-2 rounded-lg border border-ink/10 p-3 dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium text-sm">{user.username}</span>
                {!user.isActive && <span className="ml-2 text-xs text-warning">disabled</span>}
                <p className="text-xs text-text-muted">Key: {keyLabel(user.apiKeyRef)}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => update(user.id, { isActive: !user.isActive })}>
                  {user.isActive ? "Disable" : "Enable"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(user.id)}>
                  Remove
                </Button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={user.apiKeyRef || ""}
                onChange={(e) => update(user.id, { apiKeyRef: e.target.value || null })}
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
                    update(user.id, { password: value });
                    e.currentTarget.value = "";
                  }
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={create} className="mt-4 flex flex-col gap-2 border-t border-ink/10 pt-4 dark:border-white/10">
        <p className="font-medium text-sm">Add a teammate</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />
          <Input
            type="password"
            placeholder="Password (min 6 characters)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            placeholder="Display name (optional)"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
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
        </div>
        <Button type="submit" variant="primary" className="w-full sm:w-auto">
          Add teammate
        </Button>
      </form>
    </Card>
  );
}
