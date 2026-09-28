# Architecture Decision Records

Registro de decisiones de arquitectura. Un ADR es **inmutable** una vez aceptado: si la decisión
cambia, se escribe un ADR nuevo que lo reemplaza (`Estado: Reemplazado por 00XX`).

Cuándo escribir uno: al elegir/cambiar una tecnología, relajar una regla de `arch:check`, cambiar
cómo se comunican los módulos o cualquier decisión difícil de revertir.

| #    | Decisión                                                                                         | Estado   |
| ---- | ------------------------------------------------------------------------------------------------ | -------- |
| 0001 | [Monorepo con pnpm + Turborepo](0001-monorepo.md)                                                | Aceptado |
| 0002 | [Monolito modular en vez de microservicios](0002-monolito-modular.md)                            | Aceptado |
| 0003 | [Hexagonal + CQRS ligero](0003-hexagonal-cqrs-ligero.md)                                         | Aceptado |
| 0004 | [Contratos compartidos con Zod](0004-contratos-zod.md)                                           | Aceptado |
| 0005 | [Eventos de dominio in-process (outbox después)](0005-eventos.md)                                | Aceptado |
| 0006 | [Persistencia: Prisma detrás de puertos](0006-persistencia.md)                                   | Aceptado |
| 0007 | [Vocabulario compartido y errores esperados](0007-vocabulario-compartido-y-errores-esperados.md) | Aceptado |

Plantilla: [0000-plantilla.md](0000-plantilla.md).
