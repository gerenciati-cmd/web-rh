# 0009 — Países soportados (MX, DO, CO) e identificadores de empresa y persona

- **Estado**: Aceptado
- **Fecha**: 2026-09-28

## Contexto

El holding opera en México (varias sedes y estados), República Dominicana y Colombia. El repo se
había modelado sobre Chile, probablemente por imitar a Buk (SaaS chileno que la empresa renta), y
además soportaba Perú: `CountryCode = 'CL' | 'PE'` y un único `NationalId` (RUT o DNI) que servía
tanto para la empresa como para el colaborador. En Chile el RUT cubre ambos casos, pero en los
países reales la empresa y la persona tienen documentos distintos, con reglas distintas.

Los ejemplos chilenos de los ADR 0001 y 0004 (RUT) quedan como históricos: esos ADR son inmutables
y este los reemplaza en lo que respecta a los países.

## Decisión

- `SUPPORTED_COUNTRIES = ['MX', 'DO', 'CO']` en `@rrhh/domain` (`country.ts`). Chile y Perú se
  eliminan.
- Dos value objects con el mismo patrón Strategy, cada uno con un registro
  `Record<CountryCode, IdentifierValidator>` (el compilador exige los tres países):
  - `TaxId` identifica a la **empresa**: RFC de persona moral (MX), RNC (DO) o NIT (CO).
  - `NationalId` identifica a la **persona**: CURP (MX), cédula (DO) o cédula de ciudadanía (CO).
- Reglas de validación:

  | País | Empresa (`TaxId`)                  | Persona (`NationalId`)                  |
  | ---- | ---------------------------------- | --------------------------------------- |
  | MX   | RFC moral: formato + fecha, sin DV | CURP: formato, fecha real, entidad y DV |
  | DO   | RNC: 9 dígitos, sin DV             | Cédula: 11 dígitos, sin Luhn            |
  | CO   | NIT: 8–16 dígitos con DV módulo 11 | Cédula: 3–10 dígitos (no tiene DV)      |

- La referencia es python-stdnum (`mx.curp`, `mx.rfc`, `do.rnc`, `do.cedula`, `co.nit`). Solo se
  reimplementa el algoritmo; no se copia código ni datos (la librería es LGPL).
- En México el colaborador se registra con CURP. RFC y NSS se agregan con la nómina.
  _Actualización 2026-10-02 (plan `employees-rfc/001`):_ el RFC de persona física se adelantó: es
  obligatorio en el alta de colaboradores de México y único en el holding, porque los checadores
  lo usan como PIN. El NSS sigue pendiente.

## Alternativas consideradas

- **Un solo identificador con un discriminador `kind`**: permite pasar una CURP donde se espera
  el RFC de la empresa, y el compilador no obliga a cubrir los dos tipos por país.
- **Validar todos los dígitos verificadores publicados**: python-stdnum documenta que ~1,5 % de
  los RFC reales tienen el DV inválido, y lista ~1.500 cédulas dominicanas y 23 RNC reales que no
  cumplen su verificación. Validarlos rechazaría personas y empresas reales. Mantener listas de
  excepciones copiadas no es viable (licencia y mantenimiento).

## Consecuencias

- Agregar un país = agregar sus dos validadores; nada más cambia.
- Los datos de desarrollo con `CL`/`PE` dejan de cargarse (se descartan a mano).
- Una verificación débil (sin DV) en RFC, RNC y cédula DO deja pasar errores de tipeo que un DV
  detectaría. Señal para revisar: errores frecuentes de captura, o una fuente oficial con
  excepciones mantenidas.
