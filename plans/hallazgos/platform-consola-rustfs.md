---
status: discarded
module: platform
found: 2026-09-26
---

# Hallazgo descartado: se verificó una ruta incorrecta de la consola RustFS

## Qué se observó

La imagen fijada en `infra/docker/docker-compose.yml` devuelve HTTP 403 AccessDenied al
consultar la raíz del puerto 9001. La comprobación inicial interpretó esa respuesta como
un posible problema de consola, pero no consultó su ruta real.

El 2026-09-26 se volvió a arrancar solo storage del proyecto aislado `rrhh-plan001-qa`,
con el mismo digest y configuración, sin cambiar credenciales ni controles de acceso:

| Petición                                                      | Resultado                              |
| ------------------------------------------------------------- | -------------------------------------- |
| GET http://127.0.0.1:9001/                                    | 403, XML AccessDenied                  |
| GET http://127.0.0.1:9001/rustfs/console/                     | 200, HTML de la consola                |
| GET http://127.0.0.1:9001/rustfs/console/health               | 200, status ok, service rustfs-console |
| GET de una hoja CSS y tres scripts referenciados por ese HTML | 200, tipos CSS/JavaScript correctos    |

La [documentación oficial de puertos y estado](https://docs.rustfs.com/en/operations/status-check)
sitúa la consola embebida bajo `/rustfs/console/` en el puerto 9001.

## Impacto

No se confirmó un fallo de RustFS. El diagnóstico inicial usó una URL equivocada.
La carga del HTML, los recursos consultados y la salud de la consola están verificados;
no se probó login ni subida/descarga de archivos, ni se inspeccionaron credenciales del usuario.

## Propuesta

Descartar el supuesto fallo y documentar la URL completa:
http://localhost:9001/rustfs/console/.
No requiere modificar permisos, credenciales, versión o configuración del servicio.
El contenedor de QA se detuvo al terminar, conservando el volumen aislado.
