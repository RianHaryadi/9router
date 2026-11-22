# ROADMAP — 9Router Fork (RianHaryadi)

Basis: fork dari [`decolua/9router`](https://github.com/decolua/9router) (MIT). Endpoint OpenAI-compatible di `/v1`.
Dokumen ini adalah sumber kebenaran urutan pengerjaan fitur di fork. Peta teknis ada di [`docs/ARCHITECTURE_MAP.md`](docs/ARCHITECTURE_MAP.md).

---

## 1. Keputusan

- Fork 9Router, tambah fitur sendiri.
- RTK, Caveman, dan Ponytail dibangun native di dalam router (bukan tool eksternal), dikerjakan nanti.
- Fitur backend ditaruh modular di `src/custom/`, file upstream disentuh seminimal mungkin (satu titik hook di request handler).

## 2. Yang sudah ada di 9Router (jangan dibuat ulang)

- Format translation OpenAI / Claude / Gemini
- Combo fallback dan tier subscription, murah, gratis
- Quota dan usage tracking di dashboard
- RTK token saver (kompresi `tool_result`)
- Dukungan 40+ provider

> Catatan hasil pemetaan (lihat `docs/ARCHITECTURE_MAP.md` §4): **RTK, Caveman, dan Ponytail ternyata sudah diimplementasikan upstream** di `open-sse/rtk/`. Fase 1 jangan mengulanginya — yang perlu dikerjakan adalah *fitur baru* (filter per-tool/whitelist, pengukuran token yang benar, toggle per key/combo, tool-call repair generik, cache-aware routing).

## 3. Setup fork dan sync upstream

```bash
gh repo fork decolua/9router --clone
cd 9router
git remote -v            # origin = fork, upstream = decolua/9router
git checkout -b feat/transform-pipeline
git config --global rerere.enabled true
```

Aturan sync:

- Merge upstream ke branch terpisah (`sync/upstream-YYYYMMDD`) lalu PR, jangan langsung ke master.
- Jangan pernah pilih "Discard commits" di tombol Sync fork GitHub.
- Kalau bersih: review lalu merge. Kalau conflict: resolve manual, master tetap aman.
- Merge rutin dan kecil (mingguan), jangan numpuk berbulan-bulan.
- Ubah tampilan lewat layer override (CSS variables, theme file, wrapper component), bukan edit komponen upstream langsung.
- Kalau upstream ngubah `.github/workflows/`, push dari `GITHUB_TOKEN` ditolak: pakai PAT scope `workflow` atau hapus workflow upstream dari fork.
- Setting repo: Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests".

Checklist keamanan dan lisensi:

- [ ] Matikan / nonaktifkan Cloud Sync (sync konfigurasi ke cloud 9router)
- [ ] Deploy dengan `REQUIRE_API_KEY=true`, `JWT_SECRET` panjang random, `INITIAL_PASSWORD` kuat
- [ ] Pertahankan copyright notice dan teks lisensi MIT asli
- [ ] Pertimbangkan matikan atau kasih disclaimer fitur OAuth subscription (risiko ToS provider) kalau dijual

## 4. Daftar fitur tambahan

### Inti

1. Complexity routing: request simpel ke model murah, request berat ke model kuat (heuristik atau classifier kecil). Default ke model lebih kuat kalau ragu, ada override manual (`auto` / nama model langsung), keputusan routing di-log.
2. Transform pipeline: middleware toggle per key/combo: Ponytail (minimal code), Caveman (lite/full/ultra), RTK versi sendiri (rule per tool, whitelist, log token sebelum/sesudah).
3. Multi-user dan per-key budget: rate limit, budget bulanan, attribution biaya per user/project.
4. Observability: log request (latency, TTFT, token in/out), replay ke model lain.
5. Semantic cache (Redis/pgvector).
6. Circuit breaker dan health check aktif.
7. Guardrails: PII masking dan secret scanner.

### Kualitas dan reliabilitas

8. Tool-call repair (perbaiki JSON tool call rusak dari model murah, atau retry ke model lain).
9. Cache-aware routing (sticky per sesi, auto-inject `cache_control`).
10. Request queue dengan prioritas dan backoff.
11. Context window management (pindah ke window lebih besar atau ringkas history).
12. Normalisasi structured output antar provider.
13. Mid-stream failover (sambung ke model lain kalau streaming putus).
14. Reasoning/thinking control dan thinking budget per key.
15. Idempotency key dan dedup retry.

### Routing dan eksperimen

16. Virtual model / alias (`fast`, `smart`, `auto`) dengan versioning dan rollback.
17. Shadow eval dan A/B (duplikasi traffic ke model lain, nilai hasilnya).
18. Regression eval untuk combo.
19. Request hedging (kirim ke dua provider, ambil yang duluan).
20. Dukungan model lokal (Ollama / vLLM) sebagai tier gratis.
21. Batch routing untuk kerjaan non-urgent.
22. Playground di dashboard.

### Operasional

23. Notifikasi (WhatsApp / Telegram / Slack): kuota hampir habis, provider down, biaya melonjak.
24. Deteksi anomali biaya.
25. Export OpenTelemetry / Langfuse.
26. Auto-sync daftar model dan harga.
27. Enkripsi API key provider at rest, rotasi, audit akses.
28. Status page publik.

### Kalau dijual ke tim / SaaS

29. RBAC, audit log, SSO.
30. Allowlist model dan IP per key.
31. Prepaid credit dan billing (Midtrans / Xendit).
32. System prompt profile per key.
33. MCP gateway.

## 5. Pipeline request (target)

```
request masuk
  > auth + per-key config
  > complexity scoring (pilih combo)
  > RTK (compress tool_result)
  > inject Ponytail / Caveman ke system prompt (sesuai config)
  > format translation
  > provider
```

Catatan transform:

- Caveman: hanya hemat output token, nambah sekitar 1-1,5k input token per turn, bisa net-negative di sesi pendek. Default off.
- Jangan nyalakan Caveman dan Ponytail bareng secara default (kalau digabung pakai Caveman lite).
- Teks injeksi harus statis dan konsisten di awal system prompt supaya prompt cache provider tidak ter-invalidate. Kompresi RTK harus deterministik.
- Jangan terapkan Caveman ke output yang dibaca end-user (commit message, review, chatbot customer-facing).
- RTK bersifat lossy: whitelist tool dan catat token sebelum/sesudah.

## 6. Roadmap

| Fase | Isi | Alasan |
|---|---|---|
| 1 | Transform pipeline (Ponytail, Caveman, RTK), tool-call repair, cache-aware routing | Langsung hemat biaya dan bikin model murah layak dipakai |
| 2 | Per-key budget, multi-user, enkripsi key provider, idempotency | Fondasi untuk dipakai orang lain |
| 3 | Observability, circuit breaker, request queue, mid-stream failover | Reliabilitas |
| 4 | Complexity routing, shadow eval, regression eval, playground | Butuh data dari fase 3 supaya akurat |
| 5 | Semantic cache, guardrails, batch routing, billing | Polesan dan monetisasi |

## 7. Stack untuk fitur custom

FastAPI + httpx (streaming async) bila dibuat sebagai service terpisah, Redis (cooldown, rate limit, cache), Postgres (+ pgvector) untuk log dan usage, Next.js untuk dashboard. Kalau fitur ditanam langsung di fork, ikuti stack upstream (Node.js/Next.js, TypeScript).

## 8. Langkah pertama

Petakan jalur request di repo: endpoint `/v1` masuk > auth > pemilihan provider/combo > format translation > provider, untuk menemukan titik hook middleware pipeline dan complexity routing. Hasilnya jadi rencana perubahan per file.

**Status: SELESAI.** Hasil pemetaan → [`docs/ARCHITECTURE_MAP.md`](docs/ARCHITECTURE_MAP.md).

## 9. Status implementasi di fork ini

| Item | Status | Commit / Branch |
|---|---|---|
| Pemetaan arsitektur & titik hook | ✅ selesai | `docs/ARCHITECTURE_MAP.md` |
| `ROADMAP.md` + `AGENT.md` | ✅ selesai | branch `feat/architecture-map` |
| Health-based routing + circuit breaker | ✅ selesai | `feat/health-routing-observability` |
| Observability dasar (fallback chain, latency/TTFT, spend per project, API) | ✅ selesai | `feat/health-routing-observability` |
| Transform pipeline native (Fase 1) | ⏳ berikutnya | belum |
| Tool-call repair generik | ⏳ berikutnya | belum |
| Cache-aware routing | ⏳ berikutnya | belum |
