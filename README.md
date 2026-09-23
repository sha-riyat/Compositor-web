# Compositor

Un éditeur d'images complet et libre, en deux versions : l'application macOS native d'origine, et son portage vers le navigateur.

Ce dépôt les contient toutes les deux, côte à côte — parce que la version web se construit **en lisant** la version macOS, et non en la devinant.

| Dossier | Ce que c'est | État |
|---|---|---|
| [`Compositor/`](Compositor/) | L'application macOS, en Swift | Terminée, en lecture seule ici |
| [`Compositor-web/`](Compositor-web/) | Le portage navigateur, en TypeScript | En construction |

Chacun a son propre README : [celui de l'application macOS](Compositor/README.md), [celui du portage web](Compositor-web/README.md).

---

## D'où ça vient

Compositor est un éditeur d'images pour macOS écrit par [Wonder Assembly](https://github.com/robbietilton/Compositor) : calques et dossiers, masques, quatorze modes de fusion, sélections, brosse et retouche, réglages, filtres, effets de calque, texte, import PSD. Tout ce qu'on attend d'un outil de compositing, gratuitement et sous licence MIT.

Il ne tourne que sur macOS. Ce dépôt en construit une version qui tourne partout.

## Pourquoi les deux ensemble

La version Swift n'est pas là par nostalgie : **c'est la spécification du portage.**

Elle apporte quatre choses qu'aucune documentation ne remplacerait :

**Le modèle de document**, déjà conçu et éprouvé. Un tableau plat de calques plus un `parentId`, des transformations non destructives, un format `.comp` versionné de 1 à 8 avec ses règles de rejet.

**Les huit noyaux pixel en C** — baguette magique, correcteur, remplissage selon le contenu, bruit, grain, niveaux, distorsion d'objectif. 778 lignes sans dépendance Apple, qui se compilent en WebAssembly **sans modification**.

**Cinquante-quatre fichiers de tests**, qui décrivent le comportement attendu bien mieux qu'une prose le ferait. Traduits au fil des tranches, ils disent si le portage est *fidèle* ou seulement *plausible*.

**Les raisons des décisions.** Les commentaires du code Swift expliquent pourquoi la composition se fait en sRGB non linéaire, pourquoi les traits de brosse sont reconstruits par carrés alignés, pourquoi deux modes de fusion de Core Graphics doivent être contournés. Ces raisons-là valent plus que le code lui-même.

## Ce que le portage change, et ce qu'il garde

**Il garde** le modèle de document, le format de fichier, les métriques d'interface, les raccourcis, et la fidélité des pixels : un `.comp` doit faire l'aller-retour entre les deux versions sans perte.

**Il change** le moteur de rendu. Le compositeur macOS travaille sur le processeur avec Core Graphics ; celui du web travaille sur le GPU en WebGL2. Rien de ce code-là ne se transpose — il se réécrit, en s'appuyant sur ce que l'original a appris.

**Il corrige aussi**, par endroits. Les modes Densité couleur + et − de Core Graphics oublient un terme de la formule de composition, ce que l'application macOS doit contourner. Le shader web écrit la formule complète : sur un fond semi-transparent, l'écart avec l'original atteint 63 niveaux sur 255, et c'est le web qui a raison.

## Démarrer

**Le portage web** — Node 24 :

```bash
npm --prefix Compositor-web install
npm --prefix Compositor-web run dev
```

**L'application macOS** — Xcode 26 sur macOS 26.5, en ouvrant `Compositor/Compositor.xcodeproj`. Rien dans ce dossier n'est compilé ni modifié par le portage.

## Licence

MIT pour les deux, comme le projet d'origine — voir [LICENSE](LICENSE).
