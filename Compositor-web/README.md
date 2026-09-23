# Compositor Web

Le portage web de [Compositor](../README.md), l'éditeur d'images macOS dont ce dépôt est un fork.

L'objectif est un éditeur complet qui tourne dans le navigateur : calques, masques, groupes, sélections, brosse, réglages et effets, avec une fidélité suffisante pour qu'un fichier passe d'une version à l'autre sans perte.

L'application macOS d'origine occupe la racine du dépôt, **exactement telle qu'en amont** : [`Compositor/`](../Compositor/), [`CompositorTests/`](../CompositorTests/), [`docs/`](../docs/)… Elle sert de **spécification en lecture seule** — modèle de document, format `.comp`, noyaux pixel en C et 54 fichiers de tests qui décrivent le comportement attendu.

Tout le travail web vit dans ce dossier, et nulle part ailleurs. C'est ce qui permet de récupérer les nouveaux commits du dépôt d'origine sans conflit : hors de `Compositor-web/` et `.claude/`, aucun fichier ne diffère de l'amont.

## État

**T1 — le squelette qui marche.** Déposer un PNG, le déplacer, le redimensionner, l'exporter. C'est peu, et c'est délibéré : cette tranche existe pour éprouver l'architecture de bout en bout avant d'empiler quoi que ce soit.

Ce qui n'est pas encore là : les modes de fusion, les masques, les groupes, l'annulation, le format `.comp`, la brosse, les sélections, les réglages, le texte. Chacun a sa tranche, dans l'ordre.

## Démarrer

Depuis ce dossier :

```bash
nvm use          # Node 24.21.0
npm install
npm run dev      # http://localhost:5173
```

Ou depuis la racine du dépôt : `npm --prefix Compositor-web run dev`.

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Bundle de production |
| `npm test` | Suite Vitest, en Node |
| `npm run test:e2e` | Suite Playwright, sur GPU réel |
| `npm run typecheck` | Vérification des types du monorepo |

## Structure

```
packages/
├── model/      modèle de document, géométrie, stores — TS pur, zéro DOM
├── kernels/    les 8 noyaux C en WebAssembly (à partir de T6)
├── renderer/   compositeur WebGL2
├── io/         import, export, alpha, .comp (à partir de T3)
└── ui/         React — panneaux uniquement, jamais le canevas
apps/editor/    l'application Vite
tests/          régression visuelle Playwright
```

## Les quatre invariants

Ils découlent de la lecture du code Swift, pas de préférences, et les changer coûterait une réécriture.

**① On compose en sRGB non linéaire.** Le format interne des textures est `RGBA8`, jamais `SRGB8_ALPHA8` — qui décoderait vers le linéaire à l'échantillonnage. Blender en linéaire fait diverger les valeurs de Photoshop : un gris 80 % esquive vers 62 % au lieu de 100 %.

**② Alpha prémultiplié partout.** Entre l'import et le shader, tout est prémultiplié ; les deux conversions vivent dans un seul fichier, [`packages/io/src/alpha.ts`](packages/io/src/alpha.ts). `UNPACK_PREMULTIPLY_ALPHA_WEBGL` est à `false` : ce drapeau ne sert qu'aux sources DOM, qui arrivent en alpha droit.

**③ Le modèle de document ne possède aucune ressource GPU.** Il ne contient que des `AssetId`. C'est ce qui rendra abordable l'historique par instantanés partagés.

**④ Le CPU reste la source de vérité des pixels, le GPU est un cache.** Toute texture peut être jetée et reconstruite ; l'export, la sauvegarde et les noyaux WASM lisent les octets CPU.

## Technique

TypeScript, Vite, compositeur WebGL2. React 19 et React Aria Components pour les panneaux, Tailwind v4 aux métriques relevées dans l'application macOS, icônes Phosphor, typographie Geist auto-hébergée.

Le canevas n'est **jamais** rendu par React : un rendu par `pointermove` coûterait immédiatement la fluidité du trait.

L'application exige un contexte isolé entre origines (`Cross-Origin-Opener-Policy: same-origin` et `Cross-Origin-Embedder-Policy: require-corp`) pour `SharedArrayBuffer`, que le pool de workers utilisera. Conséquence : tout est auto-hébergé, y compris les polices.

## Licence

MIT, comme le projet d'origine — voir [LICENSE](../LICENSE).
