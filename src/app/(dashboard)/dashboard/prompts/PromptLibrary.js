"use client";

import { useEffect, useState } from "react";

const empty = { name: "", description: "", content: "" };

export default function PromptLibrary() {
  const [templates, setTemplates] = useState([]);
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [versions, setVersions] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/prompt-templates");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setTemplates(data.templates);
  }
  useEffect(() => { Promise.resolve().then(() => load()).catch((e) => setError(e.message)); }, []);

  async function save(event) {
    event.preventDefault();
    setError("");
    const response = await fetch(editing ? `/api/prompt-templates/${editing}` : "/api/prompt-templates", {
      method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Save failed"); return; }
    setDraft(empty); setEditing(null); await load();
  }

  async function showVersions(id) {
    const response = await fetch(`/api/prompt-templates/${id}/versions`);
    const data = await response.json();
    if (!response.ok) { setError(data.error); return; }
    setVersions(data.versions);
  }

  async function remove(id) {
    if (!window.confirm("Delete this prompt template? Version history is retained.")) return;
    const response = await fetch(`/api/prompt-templates/${id}`, { method: "DELETE" });
    if (!response.ok) { const data = await response.json(); setError(data.error); return; }
    await load();
  }

  return <main className="max-w-4xl mx-auto p-6 space-y-6">
    <h1 className="text-2xl font-semibold">Prompt library</h1>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <form onSubmit={save} className="space-y-3 rounded-xl border border-border-subtle p-4">
      <h2 className="font-medium">{editing ? "Edit template" : "New template"}</h2>
      <input aria-label="Name" required maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" className="w-full rounded border border-border-subtle bg-surface p-2" />
      <input aria-label="Description" maxLength={1000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Description (optional)" className="w-full rounded border border-border-subtle bg-surface p-2" />
      <textarea aria-label="Prompt" required value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="Prompt template" rows={8} className="w-full rounded border border-border-subtle bg-surface p-2 font-mono" />
      <div className="flex gap-2"><button className="rounded bg-primary px-4 py-2 text-white" type="submit">{editing ? "Save new version" : "Create template"}</button>{editing && <button className="rounded border px-4 py-2" type="button" onClick={() => { setEditing(null); setDraft(empty); }}>Cancel</button>}</div>
    </form>
    <section className="space-y-3">{templates.map((item) => <article key={item.id} className="rounded-xl border border-border-subtle p-4 space-y-2">
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{item.name} <span className="text-xs text-text-muted">v{item.version}</span></h2><p className="text-sm text-text-muted">{item.description}</p></div><div className="flex flex-wrap gap-2">{item.canWrite !== false && <><button className="text-primary" onClick={() => { setEditing(item.id); setDraft({ name: item.name, description: item.description, content: item.content }); }}>Edit</button></>}<button className="text-primary" onClick={() => showVersions(item.id)}>History</button>{item.canWrite !== false && <button className="text-red-600" onClick={() => remove(item.id)}>Delete</button>}</div></div>
      <pre className="whitespace-pre-wrap break-words text-sm">{item.content}</pre>
    </article>)}</section>
    {versions.length > 0 && <section className="space-y-2 rounded-xl border border-border-subtle p-4"><h2 className="font-semibold">Version history</h2>{versions.map((version) => <article key={version.version} className="border-t border-border-subtle pt-2"><h3 className="text-sm font-medium">v{version.version} · {new Date(version.createdAt).toLocaleString()}</h3><p className="font-medium">{version.name}</p><pre className="whitespace-pre-wrap break-words text-sm">{version.content}</pre></article>)}</section>}
  </main>;
}
