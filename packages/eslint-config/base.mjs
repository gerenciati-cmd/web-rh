// @ts-check
import js from '@eslint/js';
import { importX } from 'eslint-plugin-import-x';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Reglas base para todo TypeScript del monorepo (type-aware).
 * Cada paquete la extiende y solo agrega lo específico de su entorno.
 */
export const base = defineConfig([
  globalIgnores(['**/dist/**', '**/coverage/**', '**/generated/**', '**/*.config.*', '**/*.cjs']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.typescript,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      // Tipado estricto: nada de `any` escondido
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],

      // Imports ordenados y sin ciclos obvios
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', ['sibling', 'index']],
          pathGroups: [{ pattern: '@rrhh/**', group: 'internal' }],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-duplicates': 'error',
      'import-x/no-default-export': 'error',

      // Legibilidad
      complexity: ['warn', 12],
      'max-params': ['warn', 4],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Los tests pueden ser algo más laxos
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/tests/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // supertest/fetch devuelven `any` en el body; en tests se valida con expect.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'max-params': 'off',
    },
  },
]);

export default base;
