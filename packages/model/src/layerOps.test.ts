import { describe, expect, test } from 'vitest';
import {
  addLayer,
  createDocument,
  createLayer,
  duplicateLayers,
  identityTransform,
  insertBlankLayer,
  layerRange,
  moveLayer,
  removeLayers,
  renameLayer,
  setLayersOpacity,
  setLayersVisible,
} from './index.js';
import type { CompositorDocument } from './document.js';

/**
 * Traduction de la partie de `reference/CompositorTests/LayerTests.swift` qui
 * porte sur l'ordre et les opérations de pile.
 */

const stack = (...names: string[]): CompositorDocument =>
  names.reduce(
    (doc, name) =>
      addLayer(
        doc,
        createLayer(name, name, identityTransform({ width: 10, height: 10 }), `asset-${name}`),
      ),
    createDocument('d', 100, 100),
  );

const order = (doc: CompositorDocument): string[] => doc.layers.map((l) => l.id);

describe('ordre de la pile', () => {
  test('déplacer vers le haut et vers le bas', () => {
    const doc = stack('a', 'b', 'c');
    expect(order(moveLayer(doc, 'a', 2))).toEqual(['b', 'c', 'a']);
    expect(order(moveLayer(doc, 'c', 0))).toEqual(['c', 'a', 'b']);
  });

  test('un indice hors bornes est ramené dans la pile', () => {
    const doc = stack('a', 'b', 'c');
    expect(order(moveLayer(doc, 'a', 99))).toEqual(['b', 'c', 'a']);
    expect(order(moveLayer(doc, 'c', -5))).toEqual(['c', 'a', 'b']);
  });

  test('un déplacement sans effet rend le même objet', () => {
    const doc = stack('a', 'b');
    expect(moveLayer(doc, 'a', 0)).toBe(doc);
    expect(moveLayer(doc, 'inconnu', 1)).toBe(doc);
  });
});

describe('insertion et suppression', () => {
  test('un calque vide se pose au-dessus de celui visé', () => {
    const doc = insertBlankLayer(stack('a', 'b', 'c'), 'neuf', 'Calque', 'a');
    expect(order(doc)).toEqual(['a', 'neuf', 'b', 'c']);
  });

  test('sans cible, il se pose au sommet', () => {
    expect(order(insertBlankLayer(stack('a', 'b'), 'neuf', 'Calque'))).toEqual(['a', 'b', 'neuf']);
  });

  test('un calque vide couvre le document et n’a pas d’actif', () => {
    const doc = insertBlankLayer(createDocument('d', 64, 48), 'neuf', 'Calque');
    const layer = doc.layers[0]!;
    expect(layer.asset).toBeNull();
    expect(layer.transform.size).toEqual({ width: 64, height: 48 });
  });

  test('supprimer plusieurs calques est une seule opération', () => {
    expect(order(removeLayers(stack('a', 'b', 'c', 'd'), ['b', 'd']))).toEqual(['a', 'c']);
  });

  test('un enfant dont le dossier disparaît remonte à la racine', () => {
    const doc = addLayer(
      addLayer(createDocument('d', 10, 10), {
        ...createLayer('g', 'g', identityTransform({ width: 10, height: 10 })),
        isGroup: true,
      }),
      { ...createLayer('a', 'a', identityTransform({ width: 10, height: 10 })), parentId: 'g' },
    );
    const after = removeLayers(doc, ['g']);
    expect(after.layers[0]!.parentId).toBeNull();
  });

  test('supprimer rien rend le même objet', () => {
    const doc = stack('a');
    expect(removeLayers(doc, [])).toBe(doc);
    expect(removeLayers(doc, ['inconnu'])).toBe(doc);
  });
});

describe('duplication', () => {
  test('la copie se place juste au-dessus de son original', () => {
    const { document, created } = duplicateLayers(stack('a', 'b'), ['a'], () => 'a2');
    expect(order(document)).toEqual(['a', 'a2', 'b']);
    expect(created).toEqual(['a2']);
  });

  test('la copie partage les pixels plutôt que de les recopier', () => {
    const { document } = duplicateLayers(stack('a'), ['a'], () => 'a2');
    expect(document.layers[1]!.asset).toBe(document.layers[0]!.asset);
  });

  test('plusieurs copies gardent chacune leur place', () => {
    let n = 0;
    const { document } = duplicateLayers(stack('a', 'b'), ['a', 'b'], () => `copie${++n}`);
    expect(order(document)).toEqual(['a', 'copie1', 'b', 'copie2']);
  });
});

describe('opérations groupées', () => {
  test("l'opacité s'applique à toute la sélection", () => {
    const doc = setLayersOpacity(stack('a', 'b', 'c'), ['a', 'c'], 0.5);
    expect(doc.layers.map((l) => l.opacity)).toEqual([0.5, 1, 0.5]);
  });

  test("l'opacité est bornée à [0, 1]", () => {
    expect(setLayersOpacity(stack('a'), ['a'], 5).layers[0]!.opacity).toBe(1);
    expect(setLayersOpacity(stack('a'), ['a'], -5).layers[0]!.opacity).toBe(0);
  });

  test('une opacité déjà en place ne crée pas de nouvel objet', () => {
    const doc = stack('a');
    expect(setLayersOpacity(doc, ['a'], 1)).toBe(doc);
  });

  test('la visibilité se règle en bloc vers une même valeur', () => {
    const doc = setLayersVisible(stack('a', 'b'), ['a', 'b'], false);
    expect(doc.layers.every((l) => !l.isVisible)).toBe(true);
    expect(setLayersVisible(doc, ['a', 'b'], false)).toBe(doc);
  });
});

describe('renommage', () => {
  test('un nom est débarrassé de ses espaces', () => {
    expect(renameLayer(stack('a'), 'a', '  Ciel  ').layers[0]!.name).toBe('Ciel');
  });

  test('un nom vide est refusé', () => {
    const doc = stack('a');
    expect(renameLayer(doc, 'a', '   ')).toBe(doc);
  });

  test('un nom identique ne crée pas de nouvel objet', () => {
    const doc = stack('a');
    expect(renameLayer(doc, 'a', 'a')).toBe(doc);
  });
});

describe('plage de sélection', () => {
  test('la plage inclut ses deux bornes, dans les deux sens', () => {
    const doc = stack('a', 'b', 'c', 'd');
    expect(layerRange(doc, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(layerRange(doc, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  test('un seul calque donne une plage de un', () => {
    expect(layerRange(stack('a', 'b'), 'a', 'a')).toEqual(['a']);
  });

  test('une borne inconnue donne une plage vide', () => {
    expect(layerRange(stack('a'), 'a', 'z')).toEqual([]);
  });
});
