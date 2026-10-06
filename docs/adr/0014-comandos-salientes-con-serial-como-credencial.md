# 0014 — Comandos salientes al checador con el número de serie como única credencial

- **Estado**: Aceptado
- **Fecha**: 2026-10-06

## Contexto

Desde el plan `attendance-marcaciones/004` el API entrega comandos a los checadores: el equipo
consulta `GET /iclock/getrequest?SN=<serial>` y recibe el siguiente comando en cola. La
sincronización de colaboradores (`attendance-marcaciones/007`) encola comandos que llevan el
**RFC y el nombre** de cada colaborador.

El protocolo ADMS no ofrece otra credencial que el número de serie, que viene impreso en la
etiqueta del equipo (ADR 0013). La revisión del plan 004 (hallazgo M1) lo señaló: quien conozca
un serial y alcance `/iclock` puede sondear antes que el equipo real, llevarse un comando con
datos personales y dejarlo marcado como entregado, de modo que el equipo real nunca lo recibe.
El ADR 0013 ya anotaba la señal: exponer `/iclock` fuera de una red controlada exige una barrera
adicional.

## Decisión

- Se acepta el serial como única credencial **mientras `/iclock` solo sea alcanzable desde una
  red controlada** (la LAN de las sedes o una VPN). Hoy no hay ambiente desplegado.
- Exponer `/iclock` a internet requiere **antes** una barrera de red (proxy con lista de IP de
  origen permitidas, mTLS o equivalente) y un ADR nuevo que la documente.
- No se agrega código de barrera en el API.

## Alternativas consideradas

- **Barrera antes del sync**: posponer la sincronización hasta definir la infraestructura de red.
  Retrasa el valor (cargar colaboradores sin capturarlos a mano) por un riesgo que hoy no existe:
  no hay servidor expuesto.
- **Credencial adicional en el API** (token por equipo en la URL de ADMS): el firmware solo envía
  `SN` y parámetros fijos; no hay dónde configurarla.

## Consecuencias

- Mientras se cumpla la condición, el riesgo es el de cualquier dispositivo en la LAN.
- Quien roba un comando con el serial también puede responder `POST /iclock/devicecmd?SN=<serial>`
  con `ID=<n>&Return=0` (o cualquier otro código) y cerrar ese mismo comando, o cualquier otro
  `SENT` de ese equipo, como `DONE`/`FAILED` (plan 006, hallazgo L1 de su revisión): la bitácora no
  es evidencia confiable de entrega mientras el serial sea la única credencial, porque el mismo
  atacante que robó el comando puede falsificar su resultado.
- Señal para revisar: cualquier plan de despliegue que haga `/iclock` alcanzable desde fuera de
  la red controlada.
