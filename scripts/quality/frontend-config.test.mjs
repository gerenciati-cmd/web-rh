import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
const root = path.resolve(import.meta.dirname, '../..');
for (const app of ['web', 'mobile']) {
  const cwd = path.join(root, 'apps', app);
  const require = createRequire(path.join(cwd, 'package.json'));
  const { ESLint } = require('eslint');
  const eslint = new ESLint({ cwd });
  const lint = async (text, file = 'src/lib/api.ts') =>
    (await eslint.lintText(text, { filePath: path.join(cwd, file) }))[0].messages;
  test(`${app}: opciones TypeScript estrictas efectivas`, () => {
    const config = ts.readConfigFile(path.join(cwd, 'tsconfig.json'), ts.sys.readFile);
    assert.equal(config.error, undefined);
    const effective = ts.parseJsonConfigFileContent(config.config, ts.sys, cwd);
    assert.deepEqual(effective.errors, []);
    for (const flag of [
      'strict',
      'noUncheckedIndexedAccess',
      'noImplicitOverride',
      'noImplicitReturns',
      'exactOptionalPropertyTypes',
      'useUnknownInCatchVariables',
    ])
      assert.equal(effective.options[flag], true, flag);
  });
  test(`${app}: reglas realmente rechazan código inválido`, async () => {
    const messages = await lint(`import { useEffect } from 'react';
export const unsafe: any = 1;
Promise.resolve(1);
export const callback: () => void = async () => { await Promise.resolve(); };
export function missing(value: 'A' | 'B') { switch(value) { case 'A': return 1; } }
export function Component({ value }: { value: string }) { useEffect(() => { console.info(value); }, []); return null; }
export default missing;`);
    assert.ok(!messages.some((message) => message.fatal), JSON.stringify(messages));
    for (const rule of [
      '@typescript-eslint/no-explicit-any',
      '@typescript-eslint/no-floating-promises',
      '@typescript-eslint/no-misused-promises',
      '@typescript-eslint/switch-exhaustiveness-check',
      'import-x/no-default-export',
      'react-hooks/exhaustive-deps',
    ])
      assert.ok(
        messages.some((message) => message.ruleId === rule),
        `${rule}: ${JSON.stringify(messages)}`,
      );
  });
  test(`${app}: imports prohibidos y cliente autorizado`, async () => {
    for (const source of [
      '@prisma/client',
      '@rrhh/api',
      '@rrhh/api/src/container',
      '../../../api/src/container',
      '../../../apps/api/src/container',
      '@api/container',
      '../../infrastructure/database/client',
    ]) {
      const messages = await lint(`import '${source}';`);
      assert.ok(
        messages.some((message) => message.ruleId === 'no-restricted-imports'),
        source,
      );
    }
    const valid = await lint(
      "import { createApiClient } from '@rrhh/api-client';\nexport const client = createApiClient({ baseUrl: 'http://localhost:3001' });",
    );
    assert.equal(
      valid.filter((message) => message.severity === 2).length,
      0,
      JSON.stringify(valid),
    );
  });
  test(`${app}: export del framework permitido, componente común prohibido`, async () => {
    const route = app === 'web' ? 'src/app/page.tsx' : 'src/app/index.tsx';
    const messages = await lint('export default function Page() { return null; }', route);
    assert.equal(
      messages.filter((message) => message.severity === 2).length,
      0,
      JSON.stringify(messages),
    );
  });
  if (app === 'mobile')
    test('mobile: assets literales mantienen excepción acotada', async () => {
      const messages = await lint(
        "export const asset = require('@/assets/images/expo-badge.png');",
        'src/components/web-badge.tsx',
      );
      assert.equal(
        messages.filter((message) => message.severity === 2).length,
        0,
        JSON.stringify(messages),
      );
      const invalid = await lint(
        "export const other = require('../lib/api');",
        'src/components/web-badge.tsx',
      );
      assert.ok(
        invalid.some((message) => message.ruleId === '@typescript-eslint/no-require-imports'),
      );
    });
}
