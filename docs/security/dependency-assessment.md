# Evaluación de dependencias

Revisión: 2026-09-27, plan platform-calidad-integral/001. Evidencia: `pnpm audit --json` y
`pnpm --filter @rrhh/api why deepmerge-ts mysql2` sobre el lock generado después de añadir tests.
Resultado: **6 avisos: 2 altos, 3 moderados, 1 bajo; 0 críticos**. Siguen abiertos; no se suprimieron.

| Paquete instalado          | Aviso                                                                    | Severidad | Ruta resumida                                | Versión corregida indicada |
| -------------------------- | ------------------------------------------------------------------------ | --------- | -------------------------------------------- | -------------------------- |
| deepmerge-ts 7.1.5         | [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) | Alta      | API → prisma 7.10.0 → @prisma/config 7.10.0  | ≥8.0.0                     |
| mysql2 3.15.3              | [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) | Alta      | API → prisma 7.10.0                          | ≥3.22.0                    |
| mysql2 3.15.3              | [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3) | Moderada  | API → prisma 7.10.0                          | ≥3.23.1                    |
| uuid 7.0.3                 | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Moderada  | Mobile → Expo → @expo/config-plugins → xcode | ≥11.1.1                    |
| decode-uri-component 0.2.2 | [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | Moderada  | Mobile → expo-router → query-string          | ≥0.5.0                     |
| esbuild 0.27.7             | [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) | Baja      | API → tsup → bundle-require                  | ≥0.28.1                    |

## Exposición de los dos avisos altos

**deepmerge-ts:** el aviso requiere objetos recursivos controlados por un atacante; JSON ordinario
no crea ciclos. La ruta instalada es de desarrollo y carga configuración de Prisma. El archivo
`apps/api/prisma.config.ts` define configuración local, sin entrada HTTP. Por inspección, no se
identificó un camino desde un request del API hasta esa operación vulnerable. Sí está presente en
build y migrador: un archivo de configuración no confiable constituye entrada ejecutable y debe
tratarse como tal. No se hizo explotación ni se certificó una imagen publicada.

**mysql2:** el aviso alto afecta negociación de autenticación con servidores MySQL maliciosos.
Este repo usa PostgreSQL mediante `@prisma/adapter-pg`; no configura conexiones MySQL en sus
adaptadores. La dependencia entra por el CLI de Prisma, no por un import del API. No se demostró
exposición del flujo HTTP. Build/migrador conservan el CLI y deben restringir servidores/configuración
permitidos. Cambiar de proveedor o habilitar MySQL obliga a reevaluar ambos avisos mysql2.

El Dockerfile declara `deploy --prod` para runner y conserva dependencias de desarrollo en migrator.
Esto describe la construcción prevista: **no equivale a un inventario verificado de una imagen
remota ni a probar que todo paquete de desarrollo es inocuo**.

## Seguimiento

Mantener los seis avisos visibles y reevaluarlos antes de desplegar. Responsable: quien mantiene
las dependencias del repo. Preferir una versión compatible de Prisma/Expo que incorpore las
correcciones, con pruebas de migración, bundle y contratos; no forzar mayores transitivas mediante
`overrides` sin comprobar compatibilidad. La exposición de los avisos moderados/bajo no se evaluó
exhaustivamente. No se afirma que el producto esté listo para producción: autenticación,
autorización y aislamiento de datos siguen fuera de este plan.
