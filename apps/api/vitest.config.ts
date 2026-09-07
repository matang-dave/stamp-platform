import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  // SWC emits the decorator metadata Nest DI needs; esbuild alone does not.
  plugins: [tsconfigPaths(), swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    root: './',
    // *.e2e-spec.ts (apps/api/test/**) runs in the default suite too, so the
    // root `npm run test` gate covers the full acceptance flow (T11).
    include: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
  },
});
