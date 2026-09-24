import { describe, expect, test } from 'vitest';
import {
  activeAfterRemoval,
  addLayer,
  createDocument,
  createLayer,
  identityTransform,
  insertBlankLayer,
  nextBlankLayerName,
} from './index.js';
import type { CompositorDocument } from './document.js';

/**
 * Ce que l'original choisit à la place de l'utilisateur : quel calque devient
 * actif après une suppression, et comment s'appelle un calque vide.
 * Traduction de `LayerTests.deletionPreservesCanvasAndChoosesNeighbor`,
 * `deletingAMultiSelectionRemovesEveryLayerInOneStep` et
 * `blankLayersAreTransparentAndInsertedAboveSelection`.
 */

/** Une pile, du bas vers le haut. */
const stack = (...names: string[]): CompositorDocument =>
  names.reduce(
    (doc, name) =>
      addLayer(doc, createLayer(name, name, identityTransform({ width: 10, height: 10 }), `asset-${name}`)),
    createDocument('d', 800, 600),
  );

describe('le calque actif après une suppression', () => {
  test('supprimer un autre calque ne change pas le calque actif', () => {
    expect(activeAfterRemoval(stack('L1', 'L2', 'L3'), ['L1'], 'L2')).toBe('L2');
  });

  test('le calque actif supprimé cède la place à celui qui prend sa position', () => {
    // L2 part : L3 descend à sa place et devient actif.
    expect(activeAfterRemoval(stack('L1', 'L2', 'L3'), ['L2'], 'L2')).toBe('L3');
  });

  test('au sommet, c’est le nouveau sommet qui devient actif', () => {
    expect(activeAfterRemoval(stack('L1', 'L2', 'L3'), ['L3'], 'L3')).toBe('L2');
  });

  test('une pile vidée n’a plus de calque actif', () => {
    expect(activeAfterRemoval(stack('L1'), ['L1'], 'L1')).toBeNull();
  });

  /**
   * `deletingAMultiSelectionRemovesEveryLayerInOneStep` : les calques partent
   * un à un dans l'ordre de la pile, et le calque restant devient actif.
   */
  test('une sélection multiple laisse actif le calque qui reste', () => {
    expect(activeAfterRemoval(stack('garde', 'milieu', 'haut'), ['milieu', 'haut'], 'haut')).toBe('garde');
  });

  test('l’ordre de la liste d’identifiants ne compte pas, seul celui de la pile', () => {
    const doc = stack('A', 'B', 'C', 'D');
    expect(activeAfterRemoval(doc, ['C', 'B'], 'B')).toBe(activeAfterRemoval(doc, ['B', 'C'], 'B'));
    expect(activeAfterRemoval(doc, ['B', 'C'], 'B')).toBe('D');
  });

  test('sans calque actif, il n’y en a toujours pas', () => {
    expect(activeAfterRemoval(stack('L1', 'L2'), ['L1'], null)).toBeNull();
  });
});

describe('le nom d’un calque vide', () => {
  test('le premier s’appelle « Calque 1 »', () => {
    expect(nextBlankLayerName(createDocument('d', 800, 600))).toBe('Calque 1');
  });

  test('les suivants prennent le numéro d’après', () => {
    let doc = createDocument('d', 800, 600);
    for (const id of ['a', 'b', 'c']) doc = insertBlankLayer(doc, id, nextBlankLayerName(doc));
    expect(doc.layers.map((l) => l.name)).toEqual(['Calque 1', 'Calque 2', 'Calque 3']);
    expect(nextBlankLayerName(doc)).toBe('Calque 4');
  });

  test('un numéro libéré est repris', () => {
    const doc = stack('Calque 1', 'Calque 3');
    expect(nextBlankLayerName(doc)).toBe('Calque 2');
  });

  /** `blankLayersAreTransparentAndInsertedAboveSelection` : transparent, au format du canevas, à l'origine. */
  test('un calque vide couvre le canevas, sans pixels', () => {
    const doc = insertBlankLayer(stack('Calque 1', 'Calque 2', 'Calque 3'), 'nouveau', 'Calque 4', 'Calque 1');
    expect(doc.layers.map((l) => l.name)).toEqual(['Calque 1', 'Calque 4', 'Calque 2', 'Calque 3']);
    const blank = doc.layers[1]!;
    expect(blank.asset).toBeNull();
    expect(blank.transform.size).toEqual({ width: 800, height: 600 });
    expect(blank.transform.origin).toEqual({ x: 0, y: 0 });
  });
});
