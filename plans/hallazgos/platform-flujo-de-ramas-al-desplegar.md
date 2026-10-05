---
status: deferred
module: platform
found: 2026-10-03
---

# Hallazgo: definir el flujo de ramas y releases cuando exista un servidor

Origen: conversación del 2026-10-03. El usuario preguntó si debería haber ramas `staging` y `dev`
además de `main`. Decisión: **diferido** hasta que haya un ambiente desplegado ("ahorita mismo es
puro dev, pero ya más adelante desplegado sí hará falta").

## Qué se observó

- Hoy el flujo es una rama por cambio (`feat/<iniciativa>`, `fix/<modulo>-<slug>`,
  `chore/<slug>`) que sale de `main` y vuelve por PR (`AGENTS.md` → Git;
  `docs/harness/conventions/commits.md`). Un hook bloquea el push a `main`.
- No hay ningún servidor: ni staging ni producción. `main` es el código integrado, no un ambiente.
- El usuario prefiere, cuando haya despliegue, una rama `staging` por la que pase todo antes de
  `main` (feature → `staging` → `main`, con `main` = producción).

## Impacto

Ninguno mientras no haya despliegue. El riesgo aparece al desplegar: sin un paso de staging,
lo que se mezcla a `main` llegaría a producción sin probarse en un ambiente real.

## Propuesta

Al planear el primer despliegue, decidir entre:

- **Ramas por ambiente** (preferencia del usuario): feature → `staging` (se despliega a staging) →
  PR de promoción a `main` (se despliega a producción). Requiere crear `staging` desde `main`,
  proteger ambas ramas en GitHub, cambiar la base de los PR y actualizar `AGENTS.md`,
  `commits.md` y la plantilla de PR.
- **Una rama con tags**: todo a `main`, `main` se despliega a staging y un tag `vX.Y.Z` a
  producción; hotfix desde el tag. Una rama menos que mantener sincronizada.

Documentarlo en un ADR junto con el plan de despliegue.
