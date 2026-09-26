import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { http: 'src/main/http.ts', worker: 'src/main/worker.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  // Los paquetes internos (@rrhh/*) se publican como TS fuente: se empaquetan dentro del bundle.
  noExternal: [/^@rrhh\//],
});
