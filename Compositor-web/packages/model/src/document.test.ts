import { describe, expect, test } from 'vitest';
import {
  addLayer,
  createDocument,
  createLayer,
  effectiveOpacity,
  identityTransform,
  isEffectivelyVisible,
  isValidDimension,
  layersById,
  LIMITS,
  replaceLayer,
  topmostLayerAt,
  transformContains,
} from './index.js';
import type { Layer } from './layer.js';

const square = (id: string, x: number, y: number, size = 10): Layer =>
  createLayer(id, id, identityTransform({ width: size, height: size }, { x, y }), `asset-${id}`);

describe('arbre de calques', () => {
  test("l'arbre est un tableau plat plus parentId", () => {
    const group = { ...square('g', 0, 0), isGroup: true, asset: null };
    const child = { ...square('a', 0, 0), parentId: 'g' };
    const doc = addLayer(addLayer(createDocument('d', 100, 100), group), child);

    const byId = layersById(doc);
    expect(byId.get('a')?.parentId).toBe('g');
    expect(byId.get('g')?.isGroup).toBe(true);
  });

  test("l'opacité d'un dossier se multiplie dans ce qu'il contient", () => {
    const group = { ...square('g', 0, 0), isGroup: true, asset: null, opacity: 0.5 };
    const child = { ...square('a', 0, 0), parentId: 'g', opacity: 0.5 };
    const byId = layersById(addLayer(addLayer(createDocument('d', 100, 100), group), child));

    expect(effectiveOpacity(byId.get('a')!, byId)).toBeCloseTo(0.25);
    expect(effectiveOpacity(byId.get('g')!, byId)).toBeCloseTo(0.5);
  });

  test('un dossier masqué masque ses descendants sans changer leur drapeau', () => {
    const group = { ...square('g', 0, 0), isGroup: true, asset: null, isVisible: false };
    const child = { ...square('a', 0, 0), parentId: 'g' };
    const byId = layersById(addLayer(addLayer(createDocument('d', 100, 100), group), child));

    expect(isEffectivelyVisible(byId.get('a')!, byId)).toBe(false);
    // Le drapeau propre de l'enfant reste vrai : c'est de l'héritage, pas une écriture.
    expect(byId.get('a')!.isVisible).toBe(true);
  });

  test('une chaîne de parents cyclique ne boucle pas indéfiniment', () => {
    const a = { ...square('a', 0, 0), parentId: 'b' };
    const b = { ...square('b', 0, 0), parentId: 'a' };
    const byId = layersById(addLayer(addLayer(createDocument('d', 100, 100), a), b));

    expect(Number.isFinite(effectiveOpacity(byId.get('a')!, byId))).toBe(true);
    expect(isEffectivelyVisible(byId.get('a')!, byId)).toBe(true);
  });
});

describe('mutations immuables', () => {
  test("remplacer un calque ne touche pas l'instantané précédent", () => {
    const before = addLayer(createDocument('d', 100, 100), square('a', 0, 0));
    const after = replaceLayer(before, 'a', (l) => ({ ...l, opacity: 0.5 }));

    expect(before.layers[0]!.opacity).toBe(1);
    expect(after.layers[0]!.opacity).toBe(0.5);
    // Les calques non touchés sont partagés, pas copiés — c'est ce qui rend
    // l'historique par instantanés abordable.
    expect(after).not.toBe(before);
  });

  test('une mutation sans effet rend le même objet', () => {
    const doc = addLayer(createDocument('d', 100, 100), square('a', 0, 0));
    expect(replaceLayer(doc, 'a', (l) => l)).toBe(doc);
    expect(replaceLayer(doc, 'inconnu', (l) => ({ ...l, opacity: 0 }))).toBe(doc);
  });
});

describe('désignation du calque sous le pointeur', () => {
  test('le calque le plus haut gagne', () => {
    const doc = addLayer(
      addLayer(createDocument('d', 100, 100), square('bas', 0, 0, 50)),
      square('haut', 0, 0, 50),
    );
    expect(topmostLayerAt(doc, { x: 10, y: 10 })?.id).toBe('haut');
  });

  test('un calque masqué ou un dossier est ignoré', () => {
    const hidden = { ...square('haut', 0, 0, 50), isVisible: false };
    const doc = addLayer(addLayer(createDocument('d', 100, 100), square('bas', 0, 0, 50)), hidden);
    expect(topmostLayerAt(doc, { x: 10, y: 10 })?.id).toBe('bas');
  });

  test('hors de toute boîte, personne', () => {
    const doc = addLayer(createDocument('d', 100, 100), square('a', 0, 0, 10));
    expect(topmostLayerAt(doc, { x: 80, y: 80 })).toBeUndefined();
  });

  test('la rotation est prise en compte : un coin sort de la boîte tournée', () => {
    const transform = {
      ...identityTransform({ width: 10, height: 10 }, { x: 0, y: 0 }),
      radians: Math.PI / 4,
    };
    // Le coin supérieur gauche du rectangle droit tombe hors du losange tourné.
    expect(transformContains(transform, { x: 0.2, y: 0.2 })).toBe(false);
    expect(transformContains(transform, { x: 5, y: 5 })).toBe(true);
  });
});

describe('limites du document', () => {
  test('T1 borne le côté à 4096, la cible du format restant 30 000', () => {
    expect(LIMITS.maxSide).toBe(4096);
    expect(LIMITS.maxSideTarget).toBe(30_000);
    expect(isValidDimension(4096)).toBe(true);
    expect(isValidDimension(4097)).toBe(false);
  });

  test('une dimension doit être un entier positif', () => {
    expect(isValidDimension(0)).toBe(false);
    expect(isValidDimension(-1)).toBe(false);
    expect(isValidDimension(12.5)).toBe(false);
    expect(isValidDimension(1)).toBe(true);
  });
});
