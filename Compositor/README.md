# Compositor — l'application macOS

L'éditeur d'images natif d'origine, en Swift (AppKit + SwiftUI), forké depuis [robbietilton/Compositor](https://github.com/robbietilton/Compositor) sous licence MIT.

Il s'ouvre et se compile avec Xcode 26 sur macOS 26.5, en ouvrant `Compositor.xcodeproj`.

**Rien ici n'est modifié par le portage web.** Ce dossier sert de **spécification de référence** à [`../Compositor-web/`](../Compositor-web/) : le modèle de document, le format de fichier, les algorithmes et les tests y sont lus, jamais réécrits.

Voir le [README du dépôt](../README.md) pour la vue d'ensemble.

## Ce qu'on y lit

| Emplacement | Ce qu'il spécifie |
|---|---|
| `Compositor/Document/` | Le modèle de document : calques, groupes, masques, sélections, transformations, outils |
| `Compositor/Rendering/` | Le pipeline de composition, et les 8 noyaux pixel en C (`*.c`) |
| `Compositor/IO/` | Import/export, persistance, et le lecteur PSD |
| `Compositor/UI/` | Les métriques d'interface (hauteurs de contrôles, espacements, rayons) |
| `CompositorTests/` | **54 fichiers de tests** — la spécification exécutable du comportement attendu |
| `docs/project-format.md` | Le format `.comp`, versions 1 à 8, avec ses limites et règles de rejet |
| `docs/references/` | Captures de Photoshop utilisées comme cible de conception par l'auteur d'origine |

## Les noyaux C

`Compositor/Rendering/*.c` — 778 lignes sans dépendance Apple, opérant sur du RGBA prémultiplié. Ils sont compilés en WebAssembly **sans modification** par `../Compositor-web/packages/kernels`.

## Notes de portage

- **Espace de travail** : sRGB non linéaire partout, 8 bits, `premultipliedLast` + `byteOrder32Big`. La composition ne doit pas se faire en linéaire — voir le commentaire de `Rendering/SeparableBlend.swift`.
- **`Config/Info.plist`** conserve le `SUFeedURL` et la `SUPublicEDKey` du dépôt d'origine, laissés intacts pour que ce dossier ne diverge pas de l'amont.
- **SF Symbols** (les icônes utilisées par ce code) ne sont pas redistribuables hors plateformes Apple. Le portage web utilise Phosphor.
