# 0010 — Integridad referencial entre módulos sin foreign keys

- **Estado**: Aceptado
- **Fecha**: 2026-09-29

## Contexto

Los ADR 0002 y 0006 establecen un schema de Postgres por módulo y prohíben las foreign keys entre
schemas de módulos distintos. El objetivo es que las fronteras sean reales también en la base y
que un módulo (candidato: `attendance`) se pueda extraer cambiando solo sus adaptadores.

El costo es que Postgres ya no garantiza que un `company_id` guardado en `employees` exista en
`organization`: la integridad referencial entre módulos queda a cargo de la aplicación. Ninguno de
los dos ADR dice cómo. Hoy se cumple por costumbre:

- No hay borrados físicos: las empresas se desactivan (`Company.deactivate()`).
- `RegisterEmployee` consulta a `organization` vía el puerto `EmployerDirectory` antes de guardar y
  rechaza con `COMPANY_NOT_FOUND` / `COMPANY_INACTIVE`.

Si eso depende de la memoria de quien escribe cada caso de uso, tarde o temprano aparecen
referencias huérfanas. Además, en México el patrón está obligado a conservar la documentación
laboral, así que empresas, colaboradores y contratos no deberían desaparecer de la base.

## Decisión

Las foreign keys entre módulos siguen prohibidas (ADR 0002 y 0006 sin cambios). La integridad
referencial entre módulos se garantiza con dos reglas obligatorias:

1. **Sin borrado físico de datos referenciables.** Una entidad que otro módulo pueda referenciar
   por ID (empresa, colaborador, contrato, etc.) nunca se borra con `DELETE`: se da de baja con un
   estado (`active`, fecha de término o equivalente del dominio). Los repositorios de esos
   agregados no exponen métodos de borrado.
2. **Toda referencia a otro módulo se valida en el caso de uso antes de escribir**, a través de un
   puerto propio del módulo consumidor (patrón `EmployerDirectory` → adaptador sobre la fachada del
   otro módulo). El command devuelve un error de dominio con `code` estable cuando la referencia no
   existe y, si aplica, cuando está dada de baja. Cada una de esas ramas tiene su test unitario.

Las escrituras que no pasan por el API (cargas masivas, migraciones de datos desde otro sistema,
scripts) quedan fuera de estas garantías: deben pasar por los casos de uso del API o incluir su
propio chequeo de integridad antes de darse por buenas.

## Alternativas consideradas

- **Permitir FK entre schemas "cuando aporten integridad"**: toda FK aporta integridad, así que el
  criterio no discrimina y no es verificable en review ni en `arch:check`. Acopla las migraciones y
  los borrados entre módulos y obliga a desmontar las FK antes de extraer un módulo. Además Prisma
  exige el campo inverso de la relación en el modelo referenciado, lo que deja el acoplamiento
  escrito en el esquema del otro módulo.
- **FK solo hacia módulos núcleo (`organization`, `employees`) con `ON DELETE RESTRICT`**: da la
  garantía en la base para el caso más común sin bloquear la extracción de `attendance`. Se
  descarta por ahora porque, con la regla 1, la vía principal de huérfanos (el borrado) ya no
  existe, y la regla 2 cubre las escrituras desde el API. Queda como la opción a adoptar si se
  cumple la señal de revisión de abajo.

## Consecuencias

- La base no avisa si alguien escribe un ID inválido por fuera del API; ese riesgo se acepta y se
  gestiona en las cargas de datos.
- El reviewer puede exigir ambas reglas: un `delete` en un repositorio de un agregado referenciable
  o un command que guarda un ID de otro módulo sin validarlo por puerto son hallazgos.
- Validar por puerto agrega una lectura por referencia en cada escritura; es aceptable para el
  volumen de datos maestros. En escrituras de alto volumen (marcaciones de `attendance`), la
  validación puede resolverse con un caché o un índice local alimentado por eventos, sin relajar la
  regla.
- **Señal para revisar**: aparecen referencias huérfanas reales en producción, o se planea una
  migración masiva de datos históricos desde otro sistema. En ese caso, evaluar la alternativa de
  FK restringidas hacia módulos núcleo en un ADR que reemplace este.
