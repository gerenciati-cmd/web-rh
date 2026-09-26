# Integración continua

`ci.yml` se ejecuta en cada PR, push a `main` y lanzamiento manual. Usa runners de GitHub;
no requiere servidor propio, secretos de producción ni acceso a un registro privado.

| Check                       | Cobertura                                                                     | Reproducción local                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Calidad (development)       | Formato, tipos, lint, tests, arquitectura y harness con Node de `.nvmrc`      | `pnpm install --frozen-lockfile` y `pnpm check`                                                                               |
| Calidad (container-runtime) | Los mismos checks con Node 24, versión base de Docker                         | Los mismos comandos usando Node 24                                                                                            |
| PostgreSQL e integracion    | Migraciones sobre una BD efímera, adaptadores reales y diferencias de esquema | `pnpm db:generate`, `pnpm test:integration` y el comando de comparación de abajo                                              |
| Docker (api/migrator/web)   | Compilación de los tres targets, incluido Next                                | `docker build -f apps/api/Dockerfile --target runner .` (repetir con target migrator y con apps/web/Dockerfile target runner) |

La integración exige una conexión local de pruebas en `DATABASE_URL_TEST`, con nombre terminado
en `_test`. Su global setup aplica las migraciones. Para comparar después el esquema, ejecutar
desde `apps/api`, con `DATABASE_URL` apuntando a esa misma BD de pruebas:

```bash
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

La comparación falla si hay diferencias; nunca modifica la BD. No se ejecuta bootstrap ni seed
en CI. Las credenciales del servicio PostgreSQL del workflow son sintéticas y efímeras.

Las Actions están fijadas por SHA y las imágenes por digest. Para actualizar, verificar la
release en el repositorio oficial y reemplazar SHA/comentario juntos; el digest de PostgreSQL
debe coincidir con Compose. Se cachea el almacén de pnpm y las capas de Docker por target;
no se reutilizan resultados de Turbo entre ejecuciones. Las ejecuciones reemplazadas se cancelan.

El workflow no publica imágenes ni despliega. Un build exitoso no prueba el arranque del
contenedor. Mobile participa en tipos/lint, pero no se compilan binarios nativos ni se ejecutan
pruebas de navegador/dispositivo. La protección de ramas se configura por separado usando los
nombres estables de estos checks; este cambio no modifica esa configuración.
