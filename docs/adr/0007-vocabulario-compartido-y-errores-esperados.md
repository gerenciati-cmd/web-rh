# 0007 — Vocabulario puro compartido y errores esperados de persistencia

- **Estado**: Aceptado
- **Fecha**: 2026-09-27

## Contexto

El estado de empleado se repetía en dominio y contrato HTTP. Un conflicto de unicidad podía salir
como Result o como excepción según se detectara antes o durante la escritura.

## Decisión

- Un vocabulario puro y pequeño en `packages/domain/src/employees/employee-status.ts` pertenece
  conceptualmente a employees. Contiene valores y tipo derivado; no agregados, reglas, IO ni Zod.
- Dominio y contrato consumen esa definición. Prisma conserva su enum de almacenamiento; pruebas
  verifican correspondencia. Cambiar estados exige revisar la migración aunque TS compile.
- Los puertos save retornan Result con su conflicto concreto; el adaptador traduce unicidad y
  propaga excepciones inesperadas. Los commands solo publican eventos tras un save exitoso.

## Alternativas consideradas

Listas independientes con pruebas de equivalencia conservan duplicación de conocimiento. Importar
el contrato desde el dominio invierte dependencias. Un repositorio genérico no resuelve las reglas
particulares de unicidad. Mantener excepciones esperadas obliga a todos los callers a dos canales.

## Consecuencias

El shared kernel contiene vocabulario de dueño explícito; no es un cajón de tipos de pantalla.
Memoria y Prisma deben devolver el mismo conflicto. Result obliga al caller a revisar la escritura.
No cambia el contrato HTTP ni se relajan reglas de arquitectura.
