# T9 — Spesifikasi Ganti Tampilan (UI Redesign) 9router

Status: DRAFT SPEC (implementasi belum dilakukan)
Branch acuan: `sync/upstream-20261112`
File yang boleh dibuat oleh task ini: **hanya** `.loop/tasks/T9-ui-spec.md`.

---

## 0. Ringkasan keputusan

| Item | Keputusan |
|---|---|
| Karakter visual | **"Ops Console"** — instrument-panel gelap, densitas tinggi, angka rata kanan monospace, satu warna sinyal (teal), tanpa gradien oranye hangat |
| Aksen utama | `--color-brand-500: #12998B` (teal) — Light `#0C6F65`, Dark `#3FB3A6` |
| Strategi implementasi | **Ganti token di 1 file** (`src/app/globals.css`) + **rapikan 5 komponen inti** (Sidebar, Card, Badge, SegmentedControl, tabel health) + konversi hardcoded palette → token |
| Font | Inter (UI) + JetBrains Mono (angka/ID) |
| Radius | lebih tajam dari sekarang: 4/8/12/16 (sekarang 10/14) |
| Density | 2 mode: `comfortable` (default) + `compact` via `data-density="compact"` |
| Dark mode | first-class, bukan "mode gelap" — dark adalah default experienced state |

Alasan: produk ini = infra AI server. Anthem: *baca cepat, banyak data tabular, sering dipakai dalam kondisi redup*. Oranye hangat + kartu putih besar + radius 14px = "/bikin lebih modern", bukan "produk sendiri". Teal + panel gelap + tabular angka = sinyal "instrument", bukan "consumer app".

---

## 1. AUDIT TATA LETAK SAAT INI

### 1.1 File yang memegang layout global

| Peran | File | Baris kunci |
|---|---|---|
| Root layout + font + theme flash | `src/app/layout.js` | L1 `Inter` next/font → `--font-inter`; L14-17; L27-29 `viewport.themeColor: "#0a0a0a"`; L38-42 script anti-FOUC set `.dark`; L49 `<body className={inter.variable} font-sans antialiased>` |
| **Semua token warna** | `src/app/globals.css` | L14-70 `:root` (light), L72-119 `.dark`, L137-200 `@theme inline` (pemetaan token → utility Tailwind) |
| Layout dashboard (sidebar + header + konten) | `src/shared/components/layouts/DashboardLayout.js` | L1-… `flex h-screen w-full overflow-hidden bg-bg`; toasts fixed top-right; sidebar overlay mobile |
| Layout auth (login/landing shell) | `src/shared/components/layouts/AuthLayout.js` | blob glow `bg-primary/5` + `bg-orange-200/20`, `landing-grid` |
| Header (breadcrumb + judul halaman) | `src/shared/components/Header.js` | L230 `header … border-b border-border-subtle bg-surface/60 backdrop-blur-xl`; L277 judul `text-base lg:text-2xl font-semibold tracking-tight` |
| Sidebar | `src/shared/components/Sidebar.js` | L114 `aside w-72 … border-r border-border-subtle bg-vibrancy backdrop-blur-xl`; L20-41 daftar nav; L162 `nav flex-1 px-4 py-2` |
| Dark mode toggle | `src/shared/components/ThemeToggle.js` | `useTheme()` → set `.dark` di `<html>` |

Tidak ada `tailwind.config.js` — **Tailwind v4, semua token via `@theme inline`**. Konsekuensi: menambah token = edit `globals.css` saja.

### 1.2 Di mana token warna didefinisikan (peta lengkap)

`src/app/globals.css`:

- L16-25 `--color-brand-50..900` (light) — center `#E56A4A` (oranye)
- L28-29 `--color-primary`, `--color-primary-hover`
- L32-37 `--color-bg #FDFAF6`, `--color-bg-alt #F7F3EE`, `--color-surface #ffffff`, `--color-surface-2 #f4f4f5`, `--color-surface-3 #e7e7e9`, `--color-sidebar rgba(244,241,236,.85)`
- L40-41 `--color-border #e5e7eb`, `--color-border-subtle #f1f1f3`
- L44-47 `--color-text #0a0a0a`, `--color-text-main`, `--color-text-muted #6B7280`, `--color-text-subtle #9CA3AF`
- L50-53 `--color-danger #cf222e`, `--color-success #10B981`, `--color-warning #F59E0B`, `--color-info #3B82F6`
- L56-57 `--radius-brand 10px`, `--radius-brand-lg 14px`
- L60-67 shadow: `--shadow-soft`, `--shadow-warm` (oranye!), `--shadow-elevated`, `--shadow-elev`, `--shadow-focus`
- L74-83 brand scale dark (identik dengan light)
- L85-86 primary dark; L89-94 surface dark (`bg #1a1a1a`, `surface #262626`); L96-97 border dark; L99-102 text dark; L104-107 status dark
- L137-200 `@theme inline` — inilah yang membuat `bg-bg`, `text-text-muted`, `border-border`, `bg-primary`, `text-success` **ada sebagai utility**. `text-success`/`text-warning`/`text-info`/`text-danger` valid (L168-171). **Tidak ada** `text-error`.
- L198-199 `--font-sans` (Inter). **Tidak ada `--font-mono` custom.**
- L291-300 `.card-soft` / `.card-elev`
- L303-315 `.bg-hero-gradient`, `.bg-vibrancy` (dipakai Sidebar L114)
- L332-351 `.material-symbols-outlined` + `.fill-1`
- L465-474 `.landing-grid`
- L563-604 `.changelog-body` styling

### 1.3 Typography & spacing scale saat ini

- **Font**: hanya Inter (`--font-sans`, L199). Tidak ada font angka/mono kustom → tabel memakai `font-mono` bawaan Tailwind (fallback generic), sehingga lebar digit tidak konsisten.
- **Ukuran teks**: campuran `text-xs`/`text-sm`/`text-base`/`text-lg` dan arbitrary `text-[10px]`, `text-[11px]`, `text-[13px]`, `text-[15px]`. Contoh: Sidebar L183 `text-[13px] font-medium`, Badge L17 `px-2 py-0.5 text-[10px]`.
- **Radii arbitrary**：`rounded-[14px]` (Card), `rounded-[10px]` (Input/SegmentedControl), `rounded-lg` (Sidebar item), `rounded-full` (Badge).
- **Spacing**: Card `padding = md → p-6` (Card.js L20-25) — terlalu lapang untuk dashboard data; `xs → p-3`, `sm → p-4`.
- **Radius token** hanya 2 nilai (10/14).

### 1.4 Temuan audit penting (repot untuk implementer)

**A. Dead token classes.** Token berikut dipakai di kode tapi **tidak didefinisikan** di `@theme`, jadi utility-nya tidak pernah tergenerate (Tailwind v4 diam-diam mengabaikannya):

| Class | Jumlah pemakaian | Status |
|---|---|---|
| `text-text-primary` | 41 | ❌ tidak ada (`--color-text-primary`) → teks jatuh ke inherit |
| `bg-bg-subtle` | 20 | ❌ tidak ada (`--color-bg-subtle`) |
| `bg-bg-hover` | 10 | ❌ tidak ada |
| `bg-bg-secondary` | 9 | ❌ tidak ada |
| `bg-bg-tertiary` | 3 | ❌ tidak ada |
| `text-error` | 4 | ❌ tidak ada (token bernama `danger`) |
| `text-text` | 1312 | ✅ valid (`--color-text`) |
| `bg-border` | 7 | ✅ valid |

Contoh file: `src/app/(dashboard)/dashboard/usage/components/UsageTable.js:164` (`bg-bg-subtle/30`), `.../UsageChart.js:66` (`bg-bg-subtle`), `.../ProviderBarChart.js:57`, `.../TopModelsChart.js`, `.../ProviderLimits/*.js`, `src/shared/components/UsageStats.js`.

**B. Hardcoded palette Tailwind** (tidak merespons token → tidak ikut berubah saat tema diganti): `green-500/600/700`, `red-500/600`, `yellow-500/600`, `amber-500`, `blue-500/600`, `orange-500`, `bg-purple-500/10`, `bg-black/80`. Contoh: `src/shared/components/Badge.js:9-14` (semua variant warna status), `src/shared/components/Button.js:7-12`, `src/app/(dashboard)/dashboard/health/components/DataState.js:19` (`border-red-500/30 bg-red-500/10`), `src/shared/components/layouts/DashboardLayout.js` (toast wrapper), `src/shared/components/Sidebar.js:137,143,152,311,387,412,429,435`.
→ **Harus dikonversi ke token** (`bg-success/10 text-success`, dst.) atau warnanya tidak akan pernah konsisten.

**C. Chart color hardcoded** (hex literal, bukan token): `usage/components/UsageChart.js:31-33` (`#6366f1`, `#14b8a6`, `#f59e0b`), `ProviderBarChart.js:15` `COLORS` array 8 warna, `landing/page.js` hex `#f97815` / `#181411` / `#3a2f27`.

**D. Radius/typography token tidak konsisten antar file** → wajib dirapikan di token, bukan per-file.

**E. Komponen tabel belum punya komponen bersama.** Ada 6+ tabel (Health, Matrix, Latency, Projects, Fallbacks, UsageTable) yang masing-masing menulis `<table className="w-full text-left text-sm">` + `<tr className="border-b border-border/60">` sendiri. → perlu `src/shared/components/DataTable.js` (baru) atau minimal utility class `.data-table` di `globals.css`.

**F. Sidebar punya "traffic lights" macOS** (`Sidebar.js:116-120`) — elemen dekoratif yang tidak pernah berhasil (tidak window chrome). Kandidat dihapus/ubah.

---

## 2. FONDASI VISUAL BARU — "Ops Console"

Prinsip: **satu warna sinyal, sisanya netralCool**. Tidak ada gradien dekoratif, tidak ada glow, tidak ada blur oranye. Kedalaman lewat border 1px + perbedaan 1-2 level surface, bukan shadow.

### 2.1 Palet

**Light** (`bg` dingin, bukan krem hangat):

| Token | Hex | Catatan |
|---|---|---|
| `--color-bg` | `#F4F6F8` | paper dingin, 1 step di bawah surface |
| `--color-bg-alt` | `#EAEEF2` | zona sunken / header tabel |
| `--color-surface` | `#FFFFFF` | card |
| `--color-surface-2` | `#F1F4F7` | input, segmented track, hover row |
| `--color-surface-3` | `#E3E8ED` | disabled, skeleton |
| `--color-sidebar` | `#0E1218` | **sidebar gelap di light mode** —signature produk |
| `--color-border` | `#D5DBE2` | border utama |
| `--color-border-subtle` | `#E7EBF0` | pemisah row |
| `--color-text` | `#0D1117` | body |
| `--color-text-main` | `#0D1117` | heading |
| `--color-text-muted` | `#576170` | 6.2:1 vs bg ✅ |
| `--color-text-subtle` | `#7C8798` | 4.1:1 — hanya untuk teks ≥14px non-kritis |
| `--color-text-on-accent` | `#FFFFFF` | teks di atas aksen |

**Dark** (default "instrument"):

| Token | Hex | Catatan |
|---|---|---|
| `--color-bg` | `#0A0D12` | app background |
| `--color-bg-alt` | `#0E131A` | sunken |
| `--color-surface` | `#131A23` | card |
| `--color-surface-2` | `#1B232E` | input / track |
| `--color-surface-3` | `#26303C` | disabled |
| `--color-sidebar` | `#0E131A` | sedikit lebih dalam dari bg |
| `--color-border` | `#232C38` | |
| `--color-border-subtle` | `#1A222C` | |
| `--color-text` | `#E4E9F0` | |
| `--color-text-main` | `#E4E9F0` | |
| `--color-text-muted` | `#97A1B0` | 7.4:1 vs bg ✅ |
| `--color-text-subtle` | `#6B7686` | 4.3:1 — non-kritis saja |
| `--color-text-on-accent` | `#04120F` | aksen terang → teks gelap |

**Aksen (brand) — teal "signal"**:

| Token | Light | Dark |
|---|---|---|
| `--color-brand-50` | `#E6F6F3` | `#04211D` |
| `--color-brand-100` | `#C6EBE5` | `#063029` |
| `--color-brand-200` | `#8FD9CF` | `#0A4239` |
| `--color-brand-300` | `#55C2B5` | `#0F5B4F` |
| `--color-brand-400` | `#2AA396` | `#1C7A6C` |
| `--color-brand-500` | `#12998B` | `#2AA396` |
| `--color-brand-600` | `#0C6F65` | `#3FB3A6` ← **primary dark-mode** |
| `--color-brand-700` | `#0A5A52` | `#2E9184` |
| `--color-brand-800` | `#07443E` | `#237264` |
| `--color-brand-900` | `#042F2B` | `#1A564B` |

`--color-primary` = brand-600 (light) / brand-600 (dark). `--color-primary-hover` = brand-700 / brand-500.

**Status** (dipakai lewat token, bukan palette Tailwind):

| Token | Light | Dark | Catatan |
|---|---|---|---|
| `--color-success` | `#1F8A55` | `#3FBF7F` | "healthy / closed" |
| `--color-warning` | `#B07407` | `#E3A23A` | "half-open / degraded" |
| `--color-danger` | `#C8362F` | `#F2585A` | "open / error" |
| `--color-info` | `#2C6FB5` | `#5AA5F0` | info/neutral-sistem |

**Seri chart** (harus konsisten di semua chart, Light & Dark):

`--chart-1: #12998B` (teal) · `--chart-2: #4C6FD6` (indigo) · `--chart-3: #C98A1E` (amber) · `--chart-4: #A8539A` (magenta) · `--chart-5: #2C87A8` (sky) · `--chart-6: #6E8C1F` (olive)

Light: użyj versi gelap (list di atas). Dark: naikkan lightness ~+12%: `#3FB3A6`, `#7B93E8`, `#E0AC52`, `#C87BB8`, `#5FB0CE`, `#9CB84E`.

### 2.2 Contrast ratio minimum yang bisa dicapai

| Kombinasi | Light | Dark | Catatan |
|---|---|---|---|
| text-main on bg | **17.1:1** ✅ | **15.4:1** ✅ | body text target ≥ 4.5 |
| text-muted on bg | **6.2:1** ✅ | **7.4:1** ✅ | label sekunder |
| text-subtle on bg | **4.1:1** ⚠️ | **4.3:1** ⚠️ | hanya untuk teks non-kritis ≥14px atau ikon |
| brand-600 on bg | **5.1:1** ✅ | — | link/aksi teks |
| brand-600 on surface | **4.9:1** ✅ | — | |
| text-on-accent on brand-600 | **5.9:1** ✅ | **8.1:1** (`#04120F` on `#3FB3A6`) ✅ | |
| success on bg | **4.6:1** ✅ | **8.0:1** ✅ | |
| warning on bg | **4.9:1** ✅ | **9.2:1** ✅ | |
| danger on bg | **5.4:1** ✅ | **5.6:1** ✅ | |
| border on surface | 1.4:1 (visual, bukan teks) | 1.5:1 | tidak wajib 3:1, tapi **focus ring wajib** |

### 2.3 Tipografi

- **UI**: Inter (tetap, `next/font` sudah ada) — `--font-sans`.
- **Data/angka**: **JetBrains Mono** via `next/font/google` (`--font-jetbrains`) → `--font-mono`. Fallback `ui-monospace, SFMono-Regular, Menlo, monospace`.
- Skala (dipakai sebagai `--text-*` token Tailwind v4, agar bisa `text-2xs`, `text-xs`, ...):

| Token | px | weight | line-height | tracking | Pemakaian |
|---|---|---|---|---|---|
| `text-2xs` | 10 | 500 | 14px | 0.02em | badge, label uppercase, kolom Dense |
| `text-xs` | 11 | 500 | 16px | 0.01em | label tabel, meta |
| `text-sm` | 12.5 | 400 | 18px | 0 | teks sekunder, isi tabel |
| `text-base` | 14 | 400 | 21px | 0 | body aplikasi |
| `text-md` | 16 | 500 | 24px | 0 | judul card |
| `text-lg` | 19 | 600 | 27px | -0.01em | judul halaman |
| `text-xl` | 24 | 650 | 30px | -0.015em | angka KPI besar |
| `text-2xl` | 30 | 650 | 36px | -0.02em | display |

Angka **wajib** `font-mono tabular-nums` (`font-variant-numeric: tabular-nums`), kolom angka rata kanan (`text-right`).

### 2.4 Spacing & radius

- Spacing: pakai scale Tailwind standar (4px base) — **tidak menambah token baru**, tapi kurangi pemakaian padding longgar: Card default `p-6` → `p-4`; Card compact `p-3`; tabel row `py-2` (comfortable) / `py-1` (compact).
- Radius token baru:
  - `--radius-xs: 3px` (badge chip, code)
  - `--radius-sm: 5px` (input, button sm, badge)
  - `--radius-md: 8px` (button md, segmented item, icon box)
  - `--radius-lg: 12px` (card)
  - `--radius-xl: 16px` (modal, panel besar)
  - Legacy `--radius-brand: 8px`, `--radius-brand-lg: 12px` (dipakai `Card.js` & `globals.css`).

### 2.5 Treatment tabel data

- `font-variant-numeric: tabular-nums` global untuk `table`.
- **Header sticky**: `thead th { position: sticky; top: 0; z-index: 1; background: var(--color-bg-alt); }` (dalam wrapper `overflow-x-auto` yang punya `max-height`).
- **Tidak ada zebra** — pakai `border-b border-border-subtle` + `hover:bg-surface-2/60` (zebra kabur di dark). Jika > 60 baris, izinkan zebra lewat `.data-table--zebra`.
- Kolom angka: `text-right font-mono text-xs`.
- `th`: `text-2xs uppercase tracking-wider text-text-muted font-semibold px-3 py-2 border-b border-border`.
- `td`: `px-3 py-2 text-sm border-b border-border-subtle align-top`.
- Baris dengan `needs-human` → td pertama diberi `border-l-2 border-l-danger` + bg `bg-danger/5`.
- Cell yang terlalu panjang: `truncate` + `title` (pola existing) — pertahankan.

### 2.6 Treatment chart

- Stroke 2px, tanpa shadow, tanpa gradient isian_multiple (gradient filled ok 1 seri saja dengan opacity 0.12→0).
- Grid: `CartesianGrid strokeDasharray="0" vertical={false} stroke="var(--color-border)"` — **horizontal saja**, solid, 1px. (sekarang dashed 3 3 opacity 0.1 → praktis hilang).
- Axis: tanpa axis line, tanpa tick line, tick font 10px `var(--color-text-muted)`.
- Tooltip: `background var(--color-surface)`, `border 1px solid var(--color-border)`, `borderRadius 8px`, `boxShadow var(--shadow-elev)`, `fontSize 11px`, `fontFamily var(--font-mono)` untuk value, label pakai sans.
- Seri: `--chart-N` via `var(--chart-1)` (recharts menerima `stroke="var(--chart-1)"`).
- Legend: 11px uppercase tracking-wide `text-text-muted`, dot 8px.

### 2.7 Tema ikon & logo (motif "9router")

**Motif: "Nine-hop lattice"** — 9 node (3×3) di mana satu node aktif; mengilustrasikan 9 router/hop yang menyeimbangkan trafik ke banyak provider.

- Grid 3×3, radius 2.5px per node, gap 2px, di dalam kotak 32×32 rounded-lg.
- 8 node pasif: `currentColor` @ 25% opacity.
- 1 node aktif (kanan-tengah): warna aksen `var(--color-brand-500)`, dengan 1 garis "trace" tipis 1px yang menghubungkan node tengah → node aktif (opsional, untuk versi ≥ 24px).
- Warna: mono (currentColor) di sidebar/header; versi berwarna (aksen) hanya di favicon & landing hero.
- **Aturan warna**: logo tidak boleh gradient. Maksimal 2 warna (aksen + netral). Jangan pakai oranye `#f97815` lagi.
- Material Symbols tetap dipakai untuk ikon UI (sudah terpasang, `material-symbols/outlined.css` di `layout.js:3`) — konsisten dan gratis. Ikon `hub` (sidebar L126) **diganti** ke `conversion_path` / `route` agar tidak generik Material.

### 2.8 Cara masuk: ganti token atau ganti komponen?

**Rekomendasi: ganti token (1 file) + 5 komponen inti.**

Alasan:
- Mengganti token di `src/app/globals.css` (`@theme inline` + `:root` + `.dark`) menyentuh **1 file** dan langsung mengubah ~95% permukaan (semua `bg-bg`, `text-text-muted`, `border-border`, `bg-surface`, `bg-primary` ikut berubah).
- Mengganti komponen berarti menyentuh 40+ file upstream (risiko merge conflict saat sync upstream) dan hasilnya tetap akan override token — tidak sustainable.
- Maskanya: token **tidak** menjangkau (a) hardcoded palette Tailwind (§1.4B), (b) hex literal chart (§1.4C), (c) dead token classes (§1.4A), (d) arbitrary radius di komponen inti. Empat hal ini = **5 file** yang wajib disentuh.

Jadi: **Phase 1 = globals.css (token), Phase 2 = Sidebar/Card/Badge/SegmentedControl + file health (proporsi & class), Phase 3 = konversi hardcoded ke token (mechanical, low risk, boleh bertahap).**

---

## 3. SPEC PER KOMPONEN

### 3.1 Sidebar — `src/shared/components/Sidebar.js`

- **Latar**: `--color-sidebar` (gelap di kedua mode) → sidebar menjadi "rail" terpisah dari konten. Kontras surface jelas, tidak perlu shadow.
- **L Remove**: traffic lights macOS (L116-120). Ganti dengan 1 baris meta version (L132) yang dipindah ke bawah logo.
- **Logo block (L123-134)**: logo 32×32 (`size-8 rounded-lg`), teks nama `text-md font-semibold tracking-tight text-text-main`, version `text-2xs font-mono text-text-muted`.
- **Nav item (L169)**: tinggi tetap 32px, `rounded-md` (bukan `rounded-lg`), ikon `text-[16px]`, label `text-sm`.
  - idle: `text-text-muted hover:bg-surface-2/70 hover:text-text-main`
  - active: `bg-brand-500/12 text-brand-500` + **rail kiri 2px**: `border-l-2 border-brand-500` + `pl-[10px]` (geser 2px).
  - ikon active: `fill-1` (pertahankan).
- **Section header "System" (L189)**: `text-2xs font-semibold uppercase tracking-[0.12em] text-text-subtle px-3`.
- **Media accordion (L194-241)**: chevron `text-[14px]`; sub-item `text-xs` + `pl-7` (indent 16px dari parent) + rail vertikal `border-l border-border-subtle`.
- **Badge "HOT" (L311)**: ganti `bg-orange-500/15 text-orange-400` → `bg-warning/15 text-warning text-2xs font-mono uppercase tracking-wider`.
- **Update banner (L135-158)**: ganti `green-600`/`amber-500` → `bg-success/10 border-success/30 text-success` / `bg-warning/10 border-warning/30 text-warning`.
- **Width**: `w-72` (288px) → `w-64` (256px) di ≥1280px, `w-64` juga di mobile. Panel konten jadi lebih lebar.
- **Semuanya dalam 1 file** — boleh diubah total (branch ini memang bebas), tapi **hanya** `Sidebar.js`, bukan `navItems` upstream dari file lain.

### 3.2 Card — `src/shared/components/Card.js`

- Radius: `rounded-[14px]` → `rounded-lg` (12px). Semua `rounded-[10px]` internal → `rounded-md` (8px).
- Border: `border border-border-subtle` → `border border-border` (lebih tegas, khas panel).
- Shadow: **hapus** shadow default. Ganti `shadow-[var(--shadow-soft)]` → `shadow-none` + header card dipisah `border-b border-border-subtle`.
- Padding: `md` `p-6` → `p-4`; `lg` `p-8` → `p-6`; `sm` `p-4` → `p-3`; `xs` `p-3` → `p-2.5`.
- **Header card (L42-58)**: judul `text-md font-semibold text-text-main` (dari `text-text-main font-semibold` yg default 16px), subtitle `text-xs text-text-muted`. Ikon dalam kotak `size-7 rounded-md bg-surface-2 text-text-muted` (ikon 16px), **bukan** `bg-bg` (terlalu_card-dalam).
- Header + body dipisah `border-b border-border-subtle pb-3 mb-4` (opsional via prop `headerDivider`).
- `Card.Section`: `bg-bg border border-border-subtle` → `bg-bg-alt border border-border-subtle` ( sunken).
- `Card.Row` / `Card.ListItem`: `hover:bg-surface-2/50` → `hover:bg-surface-2`; `border-b border-border-subtle`.
- Tambah prop `dense` (boolean) → padding `p-2.5` + header `mb-2`.

### 3.3 Badge — `src/shared/components/Badge.js`

- **Semua variant dari hardcoded palette → token**:
  - default: `bg-surface-2 text-text-muted`
  - primary: `bg-brand-500/12 text-brand-600 dark:text-brand-500`
  - success: `bg-success/12 text-success`
  - warning: `bg-warning/12 text-warning`
  - error: `bg-danger/12 text-danger`
  - info: `bg-info/12 text-info`
- Bentuk: `rounded-full` → `rounded-xs` (3px) + `border border-current/20`? keep simple: `rounded-full` dipertahankan untuk status pill, tapi tambahkan varian `chip` dengan `rounded-xs`. Rekomendasi: **status pill tetap `rounded-full`** (scan cepat, bentuk bulat = state), **label/chip baru `rounded-xs`**.
- Tipografi: `font-semibold` → `font-medium text-2xs uppercase tracking-wider` untuk `size="sm"`; `size="md"` `text-xs font-medium` (bukan semibold).
- Dot: `size-1.5` → `size-1.5` + `ring-2 ring-current/15` (halo tipis) → kontras status di atas surface gelap.
- Padding: `sm: px-2 py-0.5 text-[10px]` → `sm: px-1.5 py-0.5 text-2xs`; `md: px-2 py-0.5 text-xs`.

### 3.4 SegmentedControl — `src/shared/components/SegmentedControl.js`

- Track: `bg-surface-2` → `bg-bg-alt border border-border-subtle`; radius `rounded-[10px]` → `rounded-md`; padding `p-1` → `p-0.5`.
- Item aktif: `bg-surface text-text-main shadow-sm` → **tidak pakai kartu putih** (terlalu "app"), pakai `bg-brand-500/12 text-brand-500` + `font-semibold`. Double-click UX: aktif ter-highlight penuh.
- Item idle: `text-text-muted hover:text-text-main hover:bg-surface-2/60`.
- Ukuran: `sm h-7` → `h-7`, `md h-9` → `h-8`, `lg h-11` → `h-10`.
- Tambahkan `role="tablist"` / `role="tab"` + `aria-selected` (accessible), dan `aria-label` dari parent.
- Health page (5 tab) memakai SegmentedControl dengan `className="w-full sm:w-auto"` → ubah jadi **underline tab bar** khusus halaman Health (lihat 3.6).

### 3.5 Tabel Matrix — `src/app/(dashboard)/dashboard/health/components/MatrixPanel.js`

Dua tabel: "Per provider" (6 kolom) dan "Account matrix" (10 kolom).

- Wrapper: `<div className="overflow-x-auto -mx-4 px-4">` agar bisa full-bleed scroll tanpa card padding terpotong; `role="region" aria-label="Account matrix" tabIndex={0}` (keyboard scroll).
- `thead`: `sticky top-0 z-10 bg-bg-alt` + `border-b border-border`.
- `th`: `text-2xs font-semibold uppercase tracking-wider text-text-muted text-left px-3 py-2 first:pl-0 last:pr-0 whitespace-nowrap`.
- `td`: `px-3 py-2 text-sm text-text-main border-b border-border-subtle align-top`.
- Kolom **numerik** (Healthy/Open/Needs human/Latency): `text-right font-mono text-xs tabular-nums`. Kolom "Needs human" berisi Badge → biarkan rata kiri, tapi angka di dalam Badge `font-mono`.
- Kolom "Provider / model": model sebagai baris kedua `text-2xs font-mono text-text-muted`.
- Kolom "Last error": `max-w-48 truncate text-xs text-text-muted` + `title`.
- **Needs-human emphasis**: row yang punya `needsHuman` → `<tr className="bg-danger/[0.04]">` + `<td>` pertama `border-l-2 border-l-danger`.
- Badge state memakai `stateVariant()` (helpers.js) → mapping sudah pas dengan token baru (`closed`→success, `half-open`→warning, else error).
- Summary subtitle: `text-2xs font-mono text-text-muted`.

### 3.6 Health & Spend (5 tab) — `src/app/(dashboard)/dashboard/health/page.js` + panels

**Struktur tab**: ganti SegmentedControl menjadi **underline tab bar** (khas console):

```
<div role="tablist" className="flex items-center gap-1 border-b border-border overflow-x-auto">
  <button role="tab" aria-selected={tab===v}
    className="px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
               border-transparent text-text-muted hover:text-text-main
               aria-[selected]:border-brand-500 aria-[selected]:text-brand-500">
```

- Indikator aktif = garis bawah 2px `brand-500` (bukan chip background). Konsisten dengan "instrument panel".
- Jumlah tab 5 → muat di satu baris ≥ 640px.

**Per panel** (semua di `health/components/`):

- *HealthPanel* (tab 1): 1 tabel breaker, 8 kolom → aturan tabel 3.5. Kolom "Failures" & "Cooldown" & "Latency" = `text-right font-mono text-xs tabular-nums`. Kolom "Blocked until" = `font-mono text-xs` (timestamp selalu mono).
- *MatrixPanel* (tab 2): lihat 3.5. Tambah **ringkasan strip** di atas (3 stat mini: Healthy / Open / Needs human) memakai `Card padding="xs"` dalam `grid grid-cols-3 gap-2` → angka `text-xl font-mono font-semibold tabular-nums`.
- *LatencyPanel* (tab 3): stat cards (p50…max) → `Card padding="xs"`, label `text-2xs uppercase tracking-wider text-text-muted`, angka `text-md font-mono font-semibold tabular-nums`. Grid `grid-cols-3 sm:grid-cols-4 lg:grid-cols-7` (7 metrik). Tabel "Provider health" mengikuti 3.5.
- *ProjectsPanel* (tab 4): "Spend by project" chart (bar) + "Project ledger" tabel. Tabel: kolom Cost/Requests/tokens → `text-right font-mono text-xs tabular-nums`; Project = `text-sm font-medium`.
- *FallbacksPanel* (tab 5): 4 filter input → `Input` komponen (bukan `<input>` mentah) agar konsisten; `grid gap-2 sm:grid-cols-4`; tombol "Refresh" `rounded-md bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium h-8 px-3`. Tabel 7 kolom, kolom Cooldown/Latency = mono right.
- *DataState.js*: loading → skeleton, bukan spinner (lebih cepat persepsi). Error → `border-danger/40 bg-danger/10 text-danger rounded-lg p-6 text-sm`. Empty → `border-border-subtle bg-surface rounded-lg p-6 text-sm text-text-muted`. Pertahankan `role="status"` / `role="alert"`.
- *helpers.js*: `money()` → `$${Number(v||0).toFixed(4)}` tetap; tambahkan `formatMs`, `formatCount` (ribuan dengan pemisah) agar angka konsisten. `date()` → `toLocaleString` tetap (tapi class mono di tabel).

### 3.7 Usage chart — `src/app/(dashboard)/dashboard/usage/components/UsageChart.js`

- Card: `p-3 sm:p-4` → `p-4`.
- **View switch** (L63-77, tombol custom) → ganti pakai **SegmentedControl** yang baru (`size="sm"`, 3 opsi Tokens/Requests/Cost). Menghapus duplikasi visual.
- Warna: `#6366f1/#14b8a6/#f59e0b` → `var(--chart-1)/var(--chart-2)/var(--chart-3)`. Gradient stop opasitas 0.25 → 0.18.
- `CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1}` → `stroke="var(--color-border)" strokeDasharray="0" vertical={false}`.
- Tick: `fill="currentColor" fillOpacity={0.5}` → `fill="var(--color-text-muted)"`, `fontSize: 10`.
- Tooltip: `backgroundColor var(--color-surface)`, `border 1px solid var(--color-border)`, `borderRadius 8`, `boxShadow var(--shadow-elev)`, `fontSize 11`, `fontFamily var(--font-mono)`.
- YAxis `width: 50` → `width: 56` (label `$0.0012` muat).
- Area `strokeWidth: 2` → `2`, `activeDot={{ r: 3, strokeWidth: 0 }}`.
- **ProviderBarChart.js**: `COLORS` array (L15) → `var(--chart-1..6)`; `Bar radius={[4,4,0,0]}` → `[3,3,0,0]`; grid horizontal solid; label kategori `font-mono text-2xs`.
- **TopModelsChart.js**: samakan perlakuan grid/tooltip/warna.

### 3.8 Providers grid — `src/app/(dashboard)/dashboard/providers/page.js`

- Grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` → **tetap**, tapi gap `gap-3 sm:gap-4` → `gap-3` (density) dan `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` dipertahankan.
- Card provider (L722-790): `Card padding="xs"` → `padding="xs"` tetap; `hover:bg-black/[0.01]` (L725) → **`hover:border-brand-500/40 hover:bg-surface-2/40`** (hapus tween hitam).
- Nama provider `font-semibold` (L764) → `text-sm font-semibold text-text-main truncate`.
- Ikon provider: kotak `size-8 rounded-lg` → `size-9 rounded-md` + `border border-border-subtle`.
- Status badge: `Badge size="sm" dot` → dengan token baru; tambah **rail status 2px di kiri card** (`border-l-2`) berwarna status (success/danger/neutral) agar cepat dipindai. Error → `border-l-danger` + `bg-danger/[0.04]`. Disabled → `opacity-50` (L725) + `border-l-border` + label "Disabled" sebagai `Badge variant="default"`.
- Toggle (L774) tetap, tapi visible on hover di desktop — pertahankan; tambahkan `aria-label`.
- Header filter chips: `bg-surface-2` → `bg-bg-alt border border-border-subtle`.

### 3.9 Endpoint & Key — `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`

- Card utama: `p-6` → `p-4`; judul `h2.text-lg font-semibold mb-4` → `text-md font-semibold mb-3 flex items-center gap-2` + ikon `text-brand-500` (bukan `text-primary` — sama saja setelah rename, tapi eksplisit).
- **URL endpoint** (`Input readOnly`, L818): `font-mono text-sm` → **`font-mono text-sm tracking-tight`** + bg `bg-bg-alt` + `border border-border` + `select-all` + `break-all`. Label "Base URL" `text-2xs uppercase tracking-wider text-text-muted`.
- Method badge (L813): `text-xs font-mono px-1.5 py-0.5 rounded` → `text-2xs font-mono font-semibold px-1.5 py-0.5 rounded-xs` + `bg-brand-500/12 text-brand-500`.
- Copy button: `p-2 hover:bg-black/5 dark:hover:bg-white/5` → `p-2 rounded-md hover:bg-surface-2 text-text-muted hover:text-text-main` + `aria-label="Copy endpoint URL"` + feedback "Copied" `text-success`.
- Key list: tiap key → row `rounded-lg border border-border-subtle bg-surface p-3` + status dot `size-1.5` + `text-sm font-mono truncate` untuk key (hanya 6 char terakhir + prefix).
- **Budget bar** (dari T7): tinggi 6px, `rounded-full bg-surface-3`, fill `bg-brand-500`, overflow bar `bg-danger`, angka `font-mono tabular-nums text-xs text-right`.
- Tab endpoint (Tunnel / TS / direct): pakai underline tab yang sama seperti Health (§3.6).
- Jangan sentuh: alur create/delete key, polling, log console.

### 3.10 Login & Landing

**Login** (`src/app/login/page.js`):
- Latar: `bg-bg` + `landing-grid` → ganti dengan **grid presisi 32px** (`.ops-grid`) + vignette `radial-gradient` sangat tipis `rgba(18,163,142,0.10)`.
- H1 "9Router" (`text-3xl font-bold text-primary`, L158) → `text-2xl font-semibold tracking-tight text-text-main` + **logo mark 40×40 di atas** (motif nine-hop), nama di `text-text-main`, bukan berwarna aksen penuh.
- Card `max-w-md` → `max-w-sm`; card memakai `border border-border` + `rounded-xl` + shadow `var(--shadow-elev)` (satu-satunya tempat shadow di app).
- Input: `Input` global di-set `bg-bg-alt border border-border focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25`.
- Tombol utama `h-10 rounded-md bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm`.
- Pesan error `text-red-500` → `text-danger text-xs flex items-center gap-1` + ikon `error` 14px.
- Divider SSO `bg-border/60` → `bg-border`.

**Landing** (`src/app/landing/page.js`):
- Ganti semua hex `#f97815` → `var(--brand-500)`; background `#181411` → `#0A0D12`; `#3a2f27` → `#232C38`.
- **Hapus 3 blob glow** (L24-26) dan **ganti** dengan 1 pola: grid presisi + satu garis "trace" horizontal teal tipis (motif nine-hop) + noise subtle. Tidak ada purple/blue blob.
- CTA: `bg-[#f97815] shadow-[0_0_20px_rgba(249,120,21,0.5)]` → `bg-brand-600 hover:bg-brand-500 text-[#04120F] font-semibold rounded-md shadow-none`. Hilangkan glow.
- H1 `font-black` → `font-semibold tracking-tight` + aksen teal pada satu kata.
- Section: `py-32` → `py-24`; container `max-w-4xl` → `max-w-5xl`; heading `text-4xl md:text-5xl font-black` → `text-3xl md:text-4xl font-semibold tracking-tight`.
- Tambah strip "terminal" statis (blok `font-mono text-xs` contoh request log) untuk memberi karakter produk.

---

## 4. CUSTOM PROPERTIES / TOKEN TABLE

### 4.1 Mapping token lama → baru

| Token lama | Nilai lama | Token baru | Light | Dark |
|---|---|---|---|---|
| `--color-bg` | #FDFAF6 | `--color-bg` | `#F4F6F8` | `#0A0D12` |
| `--color-bg-alt` | #F7F3EE | `--color-bg-alt` | `#EAEEF2` | `#0E131A` |
| `--color-surface` | #ffffff | `--color-surface` | `#FFFFFF` | `#131A23` |
| `--color-surface-2` | #f4f4f5 | `--color-surface-2` | `#F1F4F7` | `#1B232E` |
| `--color-surface-3` | #e7e7e9 | `--color-surface-3` | `#E3E8ED` | `#26303C` |
| `--color-sidebar` | rgba(244,241,236,.85) | `--color-sidebar` | `#0E1218` | `#0E131A` |
| `--color-border` | #e5e7eb | `--color-border` | `#D5DBE2` | `#232C38` |
| `--color-border-subtle` | #f1f1f3 | `--color-border-subtle` | `#E7EBF0` | `#1A222C` |
| `--color-text` | #0a0a0a | `--color-text` | `#0D1117` | `#E4E9F0` |
| `--color-text-main` | #0a0a0a | `--color-text-main` | `#0D1117` | `#E4E9F0` |
| `--color-text-muted` | #6B7280 | `--color-text-muted` | `#576170` | `#97A1B0` |
| `--color-text-subtle` | #9CA3AF | `--color-text-subtle` | `#7C8798` | `#6B7686` |
| `--color-brand-500` | #E56A4A | `--color-brand-500` | `#12998B` | `#2AA396` |
| `--color-brand-600` | #cc5236 | `--color-brand-600` | `#0C6F65` | `#3FB3A6` |
| `--color-primary` | brand-500 | `--color-primary` | `#0C6F65` | `#3FB3A6` |
| `--color-primary-hover` | brand-600 | `--color-primary-hover` | `#0A5A52` | `#2AA396` |
| `--color-success` | #10B981 | `--color-success` | `#1F8A55` | `#3FBF7F` |
| `--color-warning` | #F59E0B | `--color-warning` | `#B07407` | `#E3A23A` |
| `--color-danger` | #cf222e | `--color-danger` | `#C8362F` | `#F2585A` |
| `--color-info` | #3B82F6 | `--color-info` | `#2C6FB5` | `#5AA5F0` |
| `--radius-brand` | 10px | `--radius-brand` | `8px` | — |
| `--radius-brand-lg` | 14px | `--radius-brand-lg` | `12px` | — |
| `--shadow-warm` | oranye | `--shadow-warm` (deprecated) | `0 2px 12px -2px rgba(18,163,142,.18)` | `rgba(63,179,166,.22)` |
| `--shadow-focus` | oranye | `--shadow-focus` | `0 0 0 3px rgba(12,111,101,.22)` | `rgba(63,179,166,.26)` |

### 4.2 Token baru yang perlu ditambah

| Token | Nilai Light | Nilai Dark | Fungsi |
|---|---|---|---|
| `--color-text-on-accent` | `#FFFFFF` | `#04120F` | teks di atas aksen |
| `--color-brand-50..400,700..900` | lihat §2.1 | lihat §2.1 | skala lengkap |
| `--chart-1..6` | lihat §2.1 | lihat §2.1 | seri chart |
| `--radius-xs/sm/md/lg/xl` | 3/5/8/12/16 px | — | radius |
| `--text-2xs` | 10px/14px | — | tipografi kecil |
| `--text-sm` | 12.5px/18px | — | isi tabel |
| `--text-md` | 16px/24px | — | judul card |
| `--font-mono` | `'JetBrains Mono', ui-monospace, …` | — | angka & ID |
| `--font-sans` | `Inter, …` (tetap) | — | UI |
| `--density-row-y` | `0.5rem` / `0.25rem` | — | compact toggle |
| `--density-text` | `0.8125rem` / `0.75rem` | — | compact toggle |

### 4.3 Class utility baru (CSS di globals.css, bukan Tailwind plugin)

```css
/* tabular angka global untuk tabel */
.data-table { font-variant-numeric: tabular-nums; }
.data-table th { position: sticky; top: 0; z-index: 10; background: var(--color-bg-alt); }
.data-table tbody tr:hover { background: var(--color-surface-2); }
.data-table .num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

/* density mode */
[data-density="compact"] .data-table td { padding-top: .25rem; padding-bottom: .25rem; }
[data-density="compact"] .data-table th { padding-top: .25rem; padding-bottom: .25rem; }

/* logo motif nine-hop */
.nine-hop { display:grid; grid-template-columns: repeat(3,1fr); gap:2px; }
.nine-hop i { aspect-ratio:1; border-radius:2px; background: currentColor; opacity:.25; }
.nine-hop i.on { opacity:1; background: var(--color-brand-500); }

/* grid presisi untuk login/landing */
.ops-grid { background-image: linear-gradient(to right, var(--color-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border) 1px, transparent 1px); background-size: 32px 32px; opacity: .5; }
```

---

## 5. ATURAN AKSESIBILITAS

1. **Focus ring**: global, konsisten, 2px accent + 2px offset, tidak pernah dihapus.
   ```css
   :where(a, button, input, select, textarea, [tabindex]):focus-visible {
     outline: 2px solid var(--color-brand-500);
     outline-offset: 2px;
     border-radius: inherit;
   }
   ```
   `focus:outline-none` yang ada di `Input.js` **wajib** diganti dengan `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus:border-brand-500` (atau bolehkan default focus-visible dari global). Tidak boleh ada elemen fokus tanpa indikator.
2. **Kontras teks**: body ≥ 4.5:1, teks besar (≥18.66px bold / ≥24px) ≥ 3:1, komponen UI & border essential ≥ 3:1. Status color **tidak boleh** menjadi satu-satunya penanda → selalu,[A pairing dengan ikon atau teks (mis. "needs human" + ikon `priority_high`).
3. **Target sentuh**: min 24×24 px untuk kontrol ikon, **44×44 px** untuk target utama di mobile. Item sidebar `min-h-8` desktop → `min-h-11` di bawah `sm` (mobile drawer).
4. **Dark mode**: `.dark` di `<html>`; `color-scheme` diset per mode (sudah ada L69/L118). Semua warna yang dipakai chart/tooltip harus berbasis token, bukan hex. Hindari pure `#000`/`#fff` di dark (gunakan `#0A0D12`/`#E4E9F0`).
5. **Reduced motion**:
   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
   }
   ```
   Hapus/ganti animasi `animate-border-glow`, `animate-pulse-glow`, `btn-cta` shimmer, blob `animate-blob` di landing.
6. **Density mode**: `document.documentElement.dataset.density = "compact" | "comfortable"`, default `comfortable`, toggle di Settings (`/dashboard/profile`). Compact: row padding vertikal 4px, font tabel 12px, tutup baris `Card.Row` jadi 1px. Persist via `settingsStore` (zustand-persist) key `density`. Tidak ada density toggle di sidebar (avoid clutter).
7. **Tabel**: `scope="col"` (sudah ada di health panels), caption atau `aria-label` pada wrapper, header sticky tetap bisa di-scroll keyboard (`tabIndex={0}` + `role="region"`).
8. **Warna bukan satu-satunya sinyal**: `stateVariant` + label teks + dot; "needs human" selalu menyebut kata.
9. **Bahasa**: `lang` attr sudah ada (`layout.js:33`); `<html>` harus punya `class="dark"` sinkron sebelum paint (sudah ada script L38-42) — jangan diubah.

---

## 6. PETA PENGETAHUAN (urutan pengerjaan)

### Phase 0 — Token (1 file)
1. `src/app/globals.css` — ganti `:root`, `.dark`, `@theme inline`; tambah token baru (§4.2); tambah utility `.data-table`, `.ops-grid`, `.nine-hop`, density, focus-visible global, reduced-motion. **Satu-satunya perubahan berskala besar.**

### Phase 1 — Komponen inti (5 file)
2. `src/shared/components/Card.js`
3. `src/shared/components/Badge.js`
4. `src/shared/components/SegmentedControl.js`
5. `src/shared/components/Sidebar.js` (boleh diubah total — ini "produk sendiri")
6. `src/shared/components/Input.js` + `Button.js` (radius/border/focus ring)

### Phase 2 — Health & Spend (7 file)
7. `src/app/(dashboard)/dashboard/health/page.js` (underline tab)
8. `health/components/HealthPanel.js`
9. `health/components/MatrixPanel.js`
10. `health/components/LatencyPanel.js`
11. `health/components/ProjectsPanel.js`
12. `health/components/FallbacksPanel.js`
13. `health/components/DataState.js` + `helpers.js`

### Phase 3 — Charts & usage (4 file)
14. `usage/components/UsageChart.js`
15. `usage/components/ProviderBarChart.js`
16. `usage/components/TopModelsChart.js`
17. `usage/components/UsageTable.js` (dead token `bg-bg-subtle/30` → `bg-bg-alt/40`)

### Phase 4 — Hardcoded palette → token (mechanical, boleh bertahap)
18. `src/shared/components/Button.js`, `layout/DashboardLayout.js` (toast), `ThemeToggle.js`, `Header.js`
19. `providers/page.js`, `endpoint/EndpointPageClient.js`, `quota/*`, `token-saver/*`, `cli-tools/*`
20. Modul lain yang masih pakai `bg-orange-*`, `bg-purple-*` (landing) → ganti.

### Phase 5 — Auth & landing (2 file)
21. `src/app/login/page.js`
22. `src/app/landing/page.js` (+ `public/favicon.svg`, `public/icons/icon-192.svg`, `icon-512.svg` → motif nine-hop)

### Boleh diabaikan / tidak boleh diubah
- **Tidak boleh diubah tanpa izin**: komponen upstream di luar daftar di atas (modal auth Kiro/OAuth/ModelSelect, `UsageStats.js` 23KB, `Header.js` kecuali class token, `Footer.js`, `Pagination.js`, `Modal.js`, `Table` internal library, `ProviderIcon.js`).
- **`Sidebar.js` boleh diubah total** (ditugaskan eksplisit). Tapi **navigasi, urutan item, dan href tidak boleh berubah** — hanya kelas visual. `navItems`/`debugItems`/`systemItems` (L20-41) tetap utuh.
- `src/app/api/**`, `src/lib/**`, `src/store/**`, `i18n/**` — di luar scope.
- `health/components/helpers.js` — boleh ditambah helper, **tidak boleh** mengubah signature `stateVariant`, `money`, `date` (dipakai test T5).

### Risiko per file
| File | Risiko | Mitigasi |
|---|---|---|
| `globals.css` | Tinggi — menyentuh semua halaman |-token-based, revertible 1 file; cek semua halaman |
| `Sidebar.js` | Sedang — bisa pecah nav active state | jangan ubah `isActive()` (L73-78) & array item |
| `Card.js` | Sedang — banyak pemakai | `padding`/`elev`/`hover` prop API tidak boleh berubah signature |
| `Badge.js` | Rendah — API variant sama | ganti isi map varian saja |
| `SegmentedControl.js` | Rendah | tambah `role`/aria saja |
| health panels | Rendah | hanya class + `scope`/`aria` |
| usage charts | Sedang — recharts warnanya hex | ganti ke `var(--chart-N)`; recharts menerima CSS var untuk stroke/fill ✅ |
| landing | Rendah | halaman marketing, tidak kritikal |

---

## 7. RISIKO & VALIDASI

### Checklist risk
- [ ] Warna chart hardcoded masih ada → grep `#[0-9a-f]{6}` di `usage/components/*` dan `landing/page.js`.
- [ ] Class palette Tailwind masih ada → grep -E `(bg|text|border)-(red|green|blue|yellow|orange|amber|purple|teal|slate|gray)-[0-9]` di `src/` → target 0 di file Phase 1-3, bertahap di Phase 4.
- [ ] Dead token masih dipakai → grep -E `text-text-primary|bg-bg-subtle|bg-bg-hover|bg-bg-secondary|bg-bg-tertiary|text-error` → target 0.
- [ ] `focus:outline-none` tanpa alternatif → grep `focus:outline-none` → harus ada pasangan `focus-visible:`.
- [ ] Radius arbitrer lama `rounded-[14px]` / `rounded-[10px]` → grep → ganti `rounded-lg` / `rounded-md`.

### Prosedur validasi
1. **Screenshot baseline** (sebelum perubahan) — 9 halaman × 2 mode:
   `/dashboard` (endpoint), `/dashboard/providers`, `/dashboard/usage`, `/dashboard/health?tab=health|matrix|latency|projects|fallbacks`, `/dashboard/quota`, `/dashboard/token-saver`, `/dashboard/cli-tools`, `/login`, `/landing`.
   Viewport: 1440×900 (desktop) + 390×844 (mobile). Simpan ke `.loop/tasks/t9-shots/before/`.
   Alat: Playwright (MCP `playwright` tersedia) atau `npx playwright screenshot`.
2. **Setelah Phase 0** → ulangi screenshot → bandingkan. Harus: tidak ada elemen hilang, tidak ada teks jadi putih-on-putih, dark mode masih terbaca.
3. **Light + dark** wajib untuk semua halaman. Cek `theme` toggle (ThemeToggle) dan `prefers-color-scheme`.
4. **Health Matrix** khusus: 5 tab, cek sticky header saat scroll vertikal panjang, cek `needs-human` bar ter-highlight, cek tabel scroll horizontal di 1280px.
5. **Density toggle**: set `document.documentElement.dataset.density='compact'` di console → pastikan tabel tetap ≥24px row height & tidak ada teks terpotong.
6. **A11y**: jalankan axe (DevTools / `@axe-core/react`) di `/dashboard/health?tab=matrix` dan `/login` → target 0 violation serious/critical. Manual: tab-through seluruh sidebar & form, pastikan focus ring terlihat jelas di light & dark.
7. **Reduced motion**: DevTools → emulate `prefers-reduced-motion: reduce` → tidak ada animasi berulang.
8. **Responsive**: 390px → sidebar jadi drawer, header tetap, tabel scroll-x, grid providers 1 kolom.
9. **Lint & build**: `npx eslint src/` (harus 0 error baru) dan `npm run build` (atau `next build`) untuk memastikan tidak ada class Tailwind invalid yang menggagalkan compile.
10. **Dokumentasi**: `npx @tailwindcss/cli` tidak perlu; cukup cek `npm run dev` → inspect CSS generated → pastikan utility baru (`rounded-xs`, `text-2xs`, `bg-brand-500/12`) benar-benar tergenerate. Tailwind v4 **tidak** menghasilkan utility untuk opacity modifier di token kustom jika token itu hex — pastikan token didefinisikan sebagai hex, bukan `color-mix`, agar `/12` bekerja.

### Kriteria "selesai"
- Tidak ada warna oranye/krem hangat tersisa di UI (kecuali halaman changelog & teks historis).
- Semua halaman lolos screenshot light+dark tanpa regresi layout.
- Semua status color dari token, bukan palette Tailwind mentah.
- 0 dead-token class di file Phase 1-3.
- Focus ring terlihat di seluruh kontrol interaktif.
