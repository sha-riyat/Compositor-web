import { defineConfig } from '@playwright/test';

/**
 * La régression visuelle.
 *
 * La composition, les modes de fusion et les masques ne sont pas testables en
 * Node : ils ont besoin d'un vrai GPU. Ces tests pilotent l'éditeur par les
 * objets exposés en développement et comparent des **octets composés**, jamais
 * des captures de page — qui dépendraient des polices, du thème et de la
 * densité d'écran.
 *
 * Le Chrome installé sur la machine est utilisé plutôt que le Chromium de
 * Playwright : cela évite un téléchargement de plus de cent mégaoctets pour un
 * résultat équivalent.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
  },
  projects: [{ name: 'chrome' }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
