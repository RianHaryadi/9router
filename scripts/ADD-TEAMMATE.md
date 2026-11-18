# Bikin teammate di 9router production
#
# Format: bash scripts/add-teammate.sh <passwordOwner> <nama> <passwordTeammate> <modelAtauCombo> [budgetCents] [areas]
#
# Contoh:
#   bash scripts/add-teammate.sh 'PASS-OWNER' andi 'PASS-ANDI' 'Code-Freee' 500
#   bash scripts/add-teammate.sh 'PASS-OWNER' siti 'PASS-SITI' 'Code-Freee,Coding-Mantap' 2000
#   bash scripts/add-teammate.sh 'PASS-OWNER' rudi 'PASS-RUDI' 'Code-Freee' null 'usage,combos'
#
# areas = halaman dashboard yang boleh diakses si teammate (pisahkan koma):
#   usage      Usage & Stats, Health & Spend, Console Log, Token Saver
#   combos     Combo, Prompt Library, Translator, katalog model
#   prompts    Prompt Library
#   health     Health & Spend
#   quota      Quota Tracker
#   providers  Providers (nama provider saja, tanpa akun/email)
#   endpoint   Endpoint & Key, daftar key, kartu Teammates
#   (kosong = chat saja; basic-chat selalu ada)
#
# Yang boleh ditulis si teammate:
#   - area "combos" : buat / edit / HAPUS combo DIA SENDIRI
#   - area "prompts": buat / edit / HAPUS template DIA SENDIRI
#   Combo & template milik OWNER (dan teammate lain) cuma bisa dibaca.
#   Semua write lain (keys, providers, settings, member, shutdown) = owner only.
#
# budgetCents:
#   500  = $5/bulan   (default)
#   2000 = $20/bulan
#   null = unlimited  (tulis: null)
#
# Model/combo yang tersedia di production:
#   Code-Freee     - 15 model gratis (oc/, ag/)
#   Coding-Mantap  - model coding berbayar (cx/, cbai/, mmg/, oc/)
#   Brain-orches   - Claude Opus/Sonnet (ag/)
#   Muse           - muse spark
#   agy-muse       - antigravity + muse
#   Upload-foto    - vision (AmanAi)
#
# Setelah teammate dibuat, dia login di https://9router.aidonext.com/login
# dengan password-nya saja — tanpa username, tanpa API key.
#
# Ganti password / disable / assign ulang key:
#   Dashboard -> Profile -> kartu "Teammates"
