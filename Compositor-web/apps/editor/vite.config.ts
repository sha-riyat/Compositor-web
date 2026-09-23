import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * L'architecture partage les tuiles de pixels avec un pool de workers via
 * `SharedArrayBuffer`, qui n'existe que dans un contexte isolé entre origines.
 * Ces deux en-têtes sont donc une dépendance du moteur, pas un réglage de confort.
 *
 * Conséquence à ne pas oublier : sous `require-corp`, toute ressource tierce est
 * bloquée si elle ne porte pas d'en-tête CORP. Google Fonts et les CDN sont donc
 * hors jeu — la police Geist et tout le reste sont auto-hébergés.
 *
 * Vérification dans la console : `crossOriginIsolated === true`.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    headers: crossOriginIsolation,
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: crossOriginIsolation,
  },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
});
