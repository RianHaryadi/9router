# 9Router transform-pipeline — loop state

Branch: feat/transform-pipeline
HEAD: 62a1efdc (T7 budget UI)

Fase 1 (self): custom pipeline modules — committed 114ed84
Fase 2 (self): per-key budget backend — committed 1b6e70a8
T7 (worker-t5-ui): budget dashboard UI — committed 62a1efdc

Wave A (dispatched, working):
  T8 semantic-cache -> worker-t5-ui (w1A:p2)
  T9 idempotency    -> worker-t5-test (w1A:p3)

Pending roadmap: RTK/Caveman/Ponytail native wiring, complexity routing classifier,
wiring seams (semantic cache + idempotency into chatCore).
