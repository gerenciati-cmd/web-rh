# Contribuir a RRHH APS Holding

1. Prepara Node y pnpm según [README](README.md); ejecuta `pnpm bootstrap` en desarrollo local.
2. Trabaja en una rama `feat/`, `fix/` o `chore/`; conserva los cambios ajenos.
3. Consulta [arquitectura](docs/architecture.md) y [convenciones](docs/conventions.md).
4. Para cambios de comportamiento, usa el [workflow](docs/harness/workflow.md): un plan aprobado,
   implementación, tests, review y verificación. Los fixes pequeños tienen su fast lane documentado.
5. Ejecuta `pnpm check`; si cambias persistencia, `pnpm test:integration` contra una base local `_test`.
6. Comprueba alcance con `pnpm plans:scope <plan> --base <base-real>` y abre un PR con evidencia.

## Referencias canónicas

- [Nombres, constantes y conjuntos de valores](docs/conventions.md#constantes-y-conjuntos-de-valores).
- [Docblocks selectivos](docs/conventions.md#documentacion-del-codigo).
- [Contrato de testing](docs/harness/conventions/testing.md): capas, fixtures y resultados honestos.
- [Seguridad de agentes](docs/harness/security.md): límites reales de hooks, permisos y sandbox.
- [Commits](docs/harness/conventions/commits.md): autorización, staging explícito y español.
- [Dependencias](docs/security/dependency-assessment.md): gravedad y exposición evaluadas por separado.

No leas ni compartas `.env*` (salvo `.env.example`). No uses datos personales reales. La plataforma
actual no incorpora autenticación ni aislamiento autorizado por empresa: no está lista para datos
sensibles en producción. Un check verde no sustituye la verificación de los flujos ni prueba que
los hooks estén registrados en la herramienta de IA usada.
