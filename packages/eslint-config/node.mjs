// @ts-check
import { defineConfig } from 'eslint/config';
import globals from 'globals';

import { base } from './base.mjs';

/** Servicios Node: API HTTP y worker. */
export const node = defineConfig([
  ...base,
  {
    languageOptions: { globals: globals.node },
  },
]);

export default node;
