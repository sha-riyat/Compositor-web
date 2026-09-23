import { defineConfig } from 'vitest/config';

/**
 * Les tests de T1 tournent en **Node**, contre `model`, `io` et la partie
 * géométrique de `renderer`. Ils traduisent ce qui, dans les 54 fichiers de
 * `CompositorTests/`, ne dépend ni du GPU ni d'AppKit.
 *
 * Le reste — composition, modes de fusion, masques — part en régression
 * visuelle Playwright, qui démarre en T2 quand il y a des panneaux à comparer.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts'],
    reporters: ['default'],
  },
});
