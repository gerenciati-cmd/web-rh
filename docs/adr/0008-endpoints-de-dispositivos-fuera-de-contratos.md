# 0008 — Endpoints de dispositivos físicos fuera de los contratos

- **Estado**: Aceptado
- **Fecha**: 2026-09-28

## Contexto

Los relojes de asistencia ZKTeco (SenseFace 2A) empujan datos al servidor con el protocolo ADMS:
peticiones HTTP a rutas fijas (`/iclock/cdata`, `/iclock/getrequest`…), cuerpos `text/plain` con
líneas separadas por tabs y respuestas de texto posicionales (`OK: 2`, bloque de opciones). El
equipo no se puede reprogramar.

El ADR 0004 exige que todo endpoint se declare en `@rrhh/contracts` y se enlace con `bindRoute`,
que valida con Zod y **siempre responde JSON**. Además, `@rrhh/api-client` se deriva de ese
catálogo para web y mobile, y ningún cliente nuestro consume estas rutas.

## Decisión

Los equipos físicos que hablan un protocolo propio se atienden con un router aparte:
`AppModule.deviceRouter`, montado en la raíz de la app, fuera de `/api/v1` y fuera del catálogo
de contratos. Sus handlers son Express escritos a mano. Se exige:

- **Autenticación del equipo**: allowlist de números de serie en configuración
  (`ZKTECO_ALLOWED_SERIALS`). Una lista vacía rechaza todo.
- **Datos personales**: plantillas biométricas, fotos, claves, tarjetas y nombres nunca llegan al
  log. La redacción usa una lista cerrada de campos visibles.
- **Sin lógica de negocio en el router**: solo traduce el formato de cable. La autorización y el
  registro los hacen los casos de uso del módulo.
- El parser del body se limita a `/iclock` para no afectar a `/api/v1`.

## Alternativas consideradas

- **Modo texto en `bindRoute` + rutas en `@rrhh/contracts`**: cambia la pieza por la que pasan
  todos los endpoints y mete un protocolo de hardware en el catálogo del que se derivan los
  clientes web/mobile.
- **SDK pull por TCP 4370**: el API tendría que llegar al equipo en la LAN, y las librerías
  disponibles son ingeniería inversa mantenida por la comunidad.

## Consecuencias

- Estas rutas no tienen tipos compartidos ni verificación automática de respuesta. Las cubren
  tests HTTP propios.
- Un segundo equipo o protocolo sigue el mismo camino (`deviceRouter` en su módulo).
- Señal para revisar: si algún cliente nuestro necesita consumir estas rutas, o si el protocolo
  pasa a JSON, vuelven a los contratos.
