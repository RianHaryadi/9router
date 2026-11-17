# Bikin teammate di 9router production
#
# Format: bash scripts/add-teammate.sh <passwordOwner> <nama> <passwordTeammate> <modelAtauCombo> [budgetCents]
#
# Contoh:
#   bash scripts/add-teammate.sh 'PASS-OWNER' andi 'PASS-ANDI' 'Code-Freee' 500
#   bash scripts/add-teammate.sh 'PASS-OWNER' siti 'PASS-SITI' 'Code-Freee,Coding-Mantap' 2000
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
