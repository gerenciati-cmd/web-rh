# employees-rfc — RFC on the Mexican colaborador record

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status employees-rfc`. -->

## Goal

Store the personal RFC (persona física) of every Mexican colaborador, captured at hire and
editable afterwards, unique across the holding. Payroll (CFDI) will need it, and the ZKTeco
devices already use it as the device PIN (users are enrolled with their RFC, as Buk does today),
so `attendance-marcaciones/002` can attribute each marcación to its colaborador automatically.

## Plans

| Plan                              | Title                  | Depends on | Purpose                                                                                                                           |
| --------------------------------- | ---------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [001](001-rfc-del-colaborador.md) | RFC of the colaborador | —          | `PersonalRfc` value object; RFC required at hire for MX, unique in the holding; endpoint to set it; `EmployeesApi` lookup by RFC. |

## Dependency notes

`attendance-marcaciones/002` depends on 001 (it consumes the new `EmployeesApi` methods).

## Decisions with the user

1. (2026-10-02) The ZKTeco devices enrol each person with their **full RFC (with homoclave, all
   uppercase) as the PIN** and their full name, as Buk does today.
2. (2026-10-02) The RFC is **required** for Mexican colaboradores.
3. (2026-10-02) It is captured **both** at hire (`POST …/employees`) and afterwards (new endpoint),
   so existing colaboradores without RFC can be completed.
4. (2026-10-02) The RFC is **unique across the whole holding**: a person works for one company at a
   time; registering the same RFC twice is rejected.
5. (2026-10-02) República Dominicana and Colombia: what their devices use as PIN is unknown (the
   user guesses "something like the RFC"). Not in this series; decided when they have devices.

## Delivered

<!-- Filled when the series closes. -->

## Considered and discarded

- **Deriving the RFC from the CURP**: impossible, the 3-char homoclave is assigned by the SAT.
- **RFC unique per company only** (attribute marcaciones to the active record when it matches
  two): discarded by decision 4.
- **Validating that the RFC's first 10 chars match the CURP's**: a real-world consistency rule not
  stated by the user; not invented here.
