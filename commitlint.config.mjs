/**
 * Conventional Commits del repo. Reglas y ejemplos: docs/harness/conventions/commits.md.
 * Ej: feat(attendance): marcación con geocerca y hora del servidor
 * @type {import('@commitlint/types').UserConfig}
 */
import { readFileSync } from 'node:fs';

// Los scopes de negocio salen del registro de módulos (DRY): un módulo nuevo = scope nuevo.
const registry = JSON.parse(
  readFileSync(new URL('./docs/harness/modules.json', import.meta.url), 'utf8'),
);
const moduleScopes = registry.modules.map((module) => module.name);

const CROSS_CUTTING_SCOPES = [
  'api',
  'contracts',
  'api-client',
  'domain',
  'config',
  'db',
  'infra',
  'deps',
  'docs',
  'harness',
  'repo',
];

const GENERIC_SUBJECTS =
  /^(cambios|wip|fix|fixes|update|updates|arreglos|varios|misc|test|prueba)\.?$/i;
const AI_ATTRIBUTION = /^(co-authored-by:|.*generated with .*(claude|codex|copilot|gpt))/im;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-ai-attribution': ({ raw }) => [
          !AI_ATTRIBUTION.test(raw ?? ''),
          'sin atribución de IA: quita los trailers Co-Authored-By y las líneas "Generated with…"',
        ],
        'subject-not-generic': ({ subject }) => [
          !GENERIC_SUBJECTS.test((subject ?? '').trim()),
          'el asunto debe decir QUÉ cambió en términos de negocio (no "cambios", "wip", "fix"…)',
        ],
      },
    },
  ],
  rules: {
    'scope-empty': [2, 'never'],
    'scope-enum': [2, 'always', [...moduleScopes, ...CROSS_CUTTING_SCOPES]],
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
    'no-ai-attribution': [2, 'always'],
    'subject-not-generic': [2, 'always'],
  },
};
