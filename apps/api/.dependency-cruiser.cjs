/**
 * Reglas de arquitectura ejecutables (`pnpm arch:check`). Si una regla falla, `pnpm check` falla.
 * Cada regla documenta una decisión de docs/architecture.md; no se relajan sin un ADR.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    // ── Capas dentro de cada módulo (hexagonal) ────────────────────────────
    {
      name: 'domain-is-pure',
      comment:
        'domain/ solo puede depender de sí mismo y de @rrhh/domain. Nada de application, ' +
        'infrastructure, http, Prisma, Express ni librerías de IO.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/domain/', pathNot: '\\.test\\.ts$' },
      to: {
        pathNot: ['^src/modules/[^/]+/domain/', '@rrhh/domain', 'packages/domain'],
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'domain-no-node-builtins',
      comment: 'El dominio no hace IO: sin fs, http, crypto, etc.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/domain/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'application-no-infrastructure',
      comment:
        'application/ orquesta el dominio a través de PUERTOS. No conoce adaptadores ' +
        '(infrastructure/), ni HTTP, ni Prisma, ni Express (DIP).',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/application/', pathNot: '\\.test\\.ts$' },
      to: {
        path: [
          '^src/modules/[^/]+/(infrastructure|http)/',
          '^src/(infrastructure|http)/',
          '^src/container\\.ts$',
          'node_modules/(express|@prisma|prisma|bullmq|ioredis|awilix|pino)',
        ],
      },
    },
    {
      name: 'shared-application-is-pure',
      comment: 'Los puertos compartidos no dependen de adaptadores ni de módulos.',
      severity: 'error',
      from: { path: '^src/shared/application/' },
      to: { path: ['^src/(infrastructure|http|modules)/', '^src/container\\.ts$'] },
    },

    // ── Fronteras entre módulos (monolito modular) ─────────────────────────
    {
      name: 'modules-only-via-public-api',
      comment:
        'Un módulo solo puede usar OTRO módulo a través de su index.ts (API pública). ' +
        'Nunca sus internos (domain, application, infrastructure).',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/.+',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'cross-module-only-from-infrastructure',
      comment:
        'Solo los ADAPTADORES (infrastructure/) pueden hablar con otro módulo. El dominio y ' +
        'la aplicación declaran un puerto propio (anti-corruption layer).',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/(domain|application|http)/' },
      to: { path: '^src/modules/([^/]+)/index\\.ts$', pathNot: '^src/modules/$1/' },
    },

    // ── Persistencia encapsulada ───────────────────────────────────────────
    {
      name: 'prisma-only-in-infrastructure',
      comment: 'Solo la capa de infraestructura conoce Prisma y el cliente generado.',
      severity: 'error',
      from: {
        pathNot: [
          '^src/infrastructure/',
          '^src/modules/[^/]+/infrastructure/',
          '^src/container\\.ts$', // composition root: único lugar que ensambla adaptadores
        ],
      },
      to: { path: ['^src/infrastructure/database/', 'node_modules/@prisma/'] },
    },

    // ── Higiene general ────────────────────────────────────────────────────
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-test-code-in-production',
      comment: 'El código de producción no importa tests ni dobles de prueba.',
      severity: 'error',
      from: { pathNot: ['\\.test\\.ts$', '^tests/'] },
      to: { path: ['\\.test\\.ts$', '/testing/', '/in-memory/'] },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$', '\\.test\\.ts$', '^src/main/'],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['src/infrastructure/database/generated/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
