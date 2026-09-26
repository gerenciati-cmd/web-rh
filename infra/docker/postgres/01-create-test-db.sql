-- Se ejecuta SOLO al inicializar un volumen nuevo de Postgres.
-- Base aislada para tests de integración (DATABASE_URL_TEST). Los tests se niegan a correr
-- contra cualquier base cuyo nombre no termine en _test.
CREATE DATABASE rrhh_test;
