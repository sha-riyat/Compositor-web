/**
 * Les huit noyaux pixel en C de `reference/Compositor/Rendering/*.c`, compilés
 * en WebAssembly par Emscripten.
 *
 * 778 lignes sans dépendance Apple, opérant sur du RGBA prémultiplié — elles se
 * compilent **sans modification**. C'est l'actif le plus concret hérité du
 * projet macOS.
 *
 * Ce paquet est vide en T1 : le WASM est un no-go explicite du pari. La chaîne
 * Emscripten est montée en T6, avec les sélections, dont la baguette magique
 * (`WandPixels.c`) est le premier consommateur.
 */
export {};
