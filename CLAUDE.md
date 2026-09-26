@AGENTS.md

## Específico de Claude Code

- **Skills del pipeline** (generadas desde `docs/harness/`; no se editan a mano):
  - `planear` — Architect: escribe un plan en `plans/` (no toca código).
  - `implementar` — Implementer inline de un plan aprobado.
  - `escribir-tests` — Tester: tests por capas bajo "nada inventado".
  - `revisar` — Reviewer inline (para contexto limpio, mejor el subagente `reviewer`).
  - `verificar` — Verifier: QA en la app corriendo.
  - `fix` — fast lane para bugs chicos diagnosticados.
- **Recetas de código** (escritas a mano): `new-module`, `new-use-case`, `db-change`.
- **Subagentes** (`.claude/agents/`, generados): `implementer` (modelo según `min_implementer`:
  small→`haiku`, mid→`sonnet`, high→`opus`), `tester` (sonnet), `reviewer` (opus), `verifier`
  (sonnet). Pregunta antes de despachar si el usuario está presente (ver "Despacho de subagentes").
- **Hooks activos** (`.claude/settings.json`): `guard-bash` y `guard-files` bloquean acciones
  destructivas; si te bloquean, lee el motivo y usa la alternativa sugerida, no intentes rodearlos.
  `format-file` aplica Prettier tras cada edición.
- Para cambiar un subagente o skill del pipeline: edita `docs/harness/roles/*.md` o
  `scripts/harness/adapters.mjs` y corre `pnpm harness:sync`.
- Preferencias personales que no deben versionarse: `CLAUDE.local.md` o `.claude/settings.local.json`.
