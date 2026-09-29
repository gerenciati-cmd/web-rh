---
status: planned
module: platform
found: 2026-09-28
plan: platform-localizacion/001
---

# Hallazgo: el repo asume Chile, pero el negocio opera en México, República Dominicana y Colombia

## Qué se observó

- El usuario informa (2026-09-28) que el holding opera en **México** (reloj en Cancún, sedes en
  varios estados), **República Dominicana** (Punta Cana) y **Colombia** (Bogotá). Decisión: solo
  esos tres países; Chile y Perú quedan fuera ("chile no, nomas esos paises"). La inspiración es
  Buk (SaaS chileno que la empresa renta hoy), lo que explica el sesgo.
- `packages/domain/src/national-id/validators.ts:16`: `CountryCode = 'CL' | 'PE'`. Solo hay
  validadores de RUT chileno y DNI peruano (`validators.ts:20`, `:52`). No existe `MX`, `DO` ni
  `CO`.
- Un solo tipo `NationalId` sirve para dos cosas distintas: el identificador tributario de la
  empresa (`company.mapper.ts:14`, `taxId`) y la identificación del colaborador
  (`register-employee.command.ts:17`). En Chile el RUT cubre ambas, pero en estos países no:
  - México: la empresa tiene RFC de persona moral (12 caracteres). La persona tiene RFC (13), CURP y NSS.
  - República Dominicana: la empresa tiene RNC. La persona tiene cédula.
  - Colombia: la empresa tiene NIT con dígito verificador. La persona tiene cédula de ciudadanía.

  Esto requiere una decisión de modelo, no solo validadores nuevos.

- `CountrySchema` (`packages/contracts/src/common.ts:36`) deriva de `SUPPORTED_COUNTRIES`. Los
  contratos de empresas y colaboradores, y los tests de web y mobile (`country: 'CL'`), cambian
  con el dominio.
- Tests y documentación usan vocabulario y datos chilenos:
  - RUT de ejemplo en `apps/api/src/modules/organization/application/commands/create-company.command.test.ts`
    y en `packages/domain/src/national-id/national-id.test.ts`.
  - "AFP, Isapre, finiquito, liquidación" en `docs/harness/conventions/plans.md` (sección Language).
  - Menciones en `docs/conventions.md`, `docs/adr/0001-monorepo.md` y `docs/adr/0004-contratos-zod.md`.
- `docs/harness/modules.json` describe `attendance` con "Legal requirements apply", y la receta
  `new-module` cita a la Dirección del Trabajo (Chile) como ejemplo de regla legal.
- No hay reglas laborales chilenas implementadas: asistencia (salvo la sonda), vacaciones y
  remuneraciones aún no existen.

## Impacto

- **Alto para lo que viene, bajo hoy.** Planes futuros de asistencia, vacaciones y nómina podrían
  asumir la ley chilena. Aplican otras:
  - México: LFT, IMSS, ISR, INFONAVIT, impuesto estatal sobre nómina.
  - República Dominicana y Colombia: sus propias leyes laborales.
- Identificación: no se puede registrar un colaborador ni una empresa mexicana
  (`NationalId.create('MX', …)` no compila).
- Zona horaria: México tiene 4 zonas (Quintana Roo UTC−5, Centro UTC−6, Pacífico UTC−7,
  Noroeste UTC−8). Los equipos ZKTeco envían hora local sin desfase
  (`plans/attendance-sonda-zkteco/001-recepcion-adms-solo-log.md`, Context), así que la zona debe
  ser un dato por equipo o por sede.
- No afecta a la sonda ZKTeco ya entregada, que registra la hora tal cual.

## Propuesta

Una iniciativa `platform-localizacion` antes de planear marcaciones:

1. **Decisiones con el usuario**: países MX, DO y CO (confirmado; CL y PE se eliminan), si un colaborador puede
   estar en otro país que su empresa, y la fuente de verdad legal para cada país (asesor laboral
   o contable).
2. **Identificadores**: validadores `MX` (RFC para empresas y personas, CURP, NSS). Después `DO` y
   `CO` si se confirman. El diseño por `CountryCode` lo permite sin romper nada.
3. **Documentación y ejemplos**: reemplazar el vocabulario chileno por el mexicano en convenciones,
   recetas y datos de prueba (cédula, NSS, finiquito según LFT, etc.). Así ningún agente vuelve
   a asumir Chile.
4. **Zona horaria por sede o equipo**: decidir dónde vive (organización o attendance) como paso
   previo a `attendance-marcaciones`.

Alternativa: tratarlo país por país dentro de cada iniciativa de negocio. El riesgo es que el
sesgo chileno se cuele mientras tanto en los planes.
