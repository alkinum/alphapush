import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { defineConfig } from 'rollup';

const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './package.json');
const pkg = JSON.parse(readFileSync(packageJsonPath, { encoding: 'utf-8' }));
const plugins = [
  json(),
  resolve(),
  commonjs(),
  typescript({
    compilerOptions: {
      declaration: false,
      declarationDir: undefined,
      outDir: 'dist',
    },
  }),
];

if (process.env.NODE_ENV === 'production') {
  plugins.push(terser());
}

export default defineConfig({
  input: `src/index.ts`,
  output: [{ file: pkg.main, format: 'es' }],
  external: [],
  watch: {
    include: 'src/**',
  },
  plugins,
});
