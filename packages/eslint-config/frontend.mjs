// @ts-check
import { defineConfig } from 'eslint/config';
import { base } from './base.mjs';

/** Mantiene presets del framework; registra una sola instancia del plugin TypeScript compartido. */
export function withFrontend(presets, { mobile = false } = {}) {
  const framework = presets.flat(Infinity).map((config) => {
    const { '@typescript-eslint': _typescript, ...plugins } = config.plugins ?? {};
    return { ...config, ...(config.plugins ? { plugins } : {}) };
  });
  return defineConfig([
    ...framework,
    ...base,
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        'import/order': 'off',
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex:
                  '(^@prisma(/|$)|^prisma$|(^|/)apps/api(/|$)|^@api(/|$)|^@rrhh/api(/|$)|(^|/)api/(src|prisma)(/|$)|(^|/)infrastructure(/|$))',
                message:
                  'La UI consume @rrhh/api-client y @rrhh/contracts; no importa persistencia ni fuentes del API.',
              },
            ],
          },
        ],
      },
    },
    {
      files: mobile
        ? ['src/app/**/*.tsx']
        : ['src/app/**/{page,layout,loading,error,not-found,template,default,global-error}.tsx'],
      rules: { 'import-x/no-default-export': 'off' },
    },
    ...(mobile
      ? [
          {
            files: ['src/components/{animated-icon,animated-icon.web,app-tabs,web-badge}.tsx'],
            rules: {
              // Metro requiere require literal para assets estáticos; no habilita imports dinámicos de código.
              '@typescript-eslint/no-require-imports': ['error', { allow: ['^@/assets/'] }],
              '@typescript-eslint/no-unsafe-assignment': 'off',
            },
          },
        ]
      : []),
  ]);
}
