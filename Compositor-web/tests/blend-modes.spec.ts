import { expect, test, type Page } from '@playwright/test';
import { ALL_MODES, composite, type BlendMode } from './reference/blend.js';

/**
 * Les vingt-quatre modes de fusion, comparés à une implémentation de référence
 * écrite en TypeScript — le GPU exécute du GLSL, la référence tourne sur le
 * processeur, et les deux doivent tomber sur les mêmes octets.
 *
 * Les couleurs sont injectées directement dans le magasin d'actifs plutôt que
 * décodées depuis un PNG : le test porte sur la composition, pas sur le
 * décodage, et des octets choisis évitent les arrondis d'un encodage.
 */

interface Case {
  readonly name: string;
  /** Couleur **droite**, comme elle sortirait d'un fichier. */
  readonly backdrop: readonly [number, number, number, number];
  readonly source: readonly [number, number, number, number];
}

/**
 * Les cas à fond semi-transparent sont les plus importants : ce sont les seuls
 * qui exercent le terme `(1−αb)·αs·Cs` que Core Graphics laisse tomber. Avec un
 * fond opaque ce terme vaut zéro, et le défaut reste invisible.
 */
const CASES: readonly Case[] = [
  { name: 'fond opaque, source opaque', backdrop: [64, 160, 96, 255], source: [208, 96, 32, 255] },
  { name: 'fond opaque, source a 60 pourcent', backdrop: [64, 160, 96, 255], source: [208, 96, 32, 153] },
  { name: 'fond a 50 pourcent, source a 60 pourcent', backdrop: [64, 160, 96, 128], source: [208, 96, 32, 153] },
  { name: 'fond a 25 pourcent, source opaque', backdrop: [230, 40, 180, 64], source: [20, 220, 90, 255] },
  { name: 'noir sous blanc', backdrop: [0, 0, 0, 255], source: [255, 255, 255, 200] },
  { name: 'blanc sous noir', backdrop: [255, 255, 255, 255], source: [0, 0, 0, 200] },
  // Soustraction et Division ne sont pas symétriques : un cas où le fond est
  // plus clair que la source, un autre où c'est l'inverse.
  { name: 'fond clair, source sombre', backdrop: [204, 180, 150, 255], source: [102, 60, 30, 255] },
  { name: 'fond sombre, source claire', backdrop: [102, 60, 30, 255], source: [204, 180, 150, 255] },
];

/**
 * Alpha droit vers prémultiplié, arrondi à l'octet — exactement ce que fait
 * l'import, et donc exactement ce que la texture contiendra.
 */
const premultiply = (
  rgba: readonly [number, number, number, number],
): [number, number, number, number] => {
  const a = rgba[3];
  const scale = a / 255;
  return [
    Math.round(rgba[0] * scale),
    Math.round(rgba[1] * scale),
    Math.round(rgba[2] * scale),
    a,
  ];
};

/** La couleur droite telle que le shader la reconstruira depuis ces octets. */
const straighten = (
  premul: readonly [number, number, number, number],
): [number, number, number] =>
  premul[3] === 0
    ? [0, 0, 0]
    : [premul[0] / premul[3], premul[1] / premul[3], premul[2] / premul[3]];

const prepare = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(
    () =>
      (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !==
      undefined,
    undefined,
    { timeout: 30_000 },
  );
  // Sans contexte isolé entre origines, les en-têtes COOP/COEP ne sont pas
  // servis — et le reste de l'architecture ne tiendrait pas non plus.
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
};

/** Compose deux calques unis et rend le premier pixel. */
const compositePixel = async (
  page: Page,
  backdrop: readonly number[],
  source: readonly number[],
  mode: BlendMode,
): Promise<number[]> =>
  page.evaluate(
    ({ backdrop, source, mode }) => {
      const globals = window as never as {
        __compositor: {
          documentStore: {
            getState(): { assets: { add(b: unknown): string } };
            setState(s: unknown): void;
          };
          compositor: { composite(d: unknown): Uint8ClampedArray };
        };
      };
      const { documentStore, compositor } = globals.__compositor;

      const buffer = (rgba: readonly number[]) => {
        const data = new Uint8ClampedArray(4 * 4 * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = rgba[0]!;
          data[i + 1] = rgba[1]!;
          data[i + 2] = rgba[2]!;
          data[i + 3] = rgba[3]!;
        }
        return { width: 4, height: 4, data };
      };

      const assets = documentStore.getState().assets;
      const lower = assets.add(buffer(backdrop));
      const upper = assets.add(buffer(source));

      const layer = (id: string, asset: string, blendMode: string) => ({
        id,
        asset,
        transform: {
          origin: { x: 0, y: 0 },
          size: { width: 4, height: 4 },
          radians: 0,
          flipX: false,
          flipY: false,
          sampling: 'nearest',
        },
        name: id,
        isVisible: true,
        parentId: null,
        isGroup: false,
        opacity: 1,
        blendMode,
      });

      const document = {
        id: 'test',
        width: 4,
        height: 4,
        resolution: 72,
        layers: [layer('bas', lower, 'normal'), layer('haut', upper, mode)],
      };

      documentStore.setState({ document, activeLayerId: null });
      const pixels = compositor.composite(document);
      return [pixels[0]!, pixels[1]!, pixels[2]!, pixels[3]!];
    },
    { backdrop: [...backdrop], source: [...source], mode },
  );

/**
 * Une seule page pour tout le fichier. Chaque cas ne fait qu'injecter des
 * octets et composer : recharger l'éditeur entre deux assertions coûterait
 * plusieurs minutes pour aucune isolation utile, puisque le document est
 * remplacé à chaque appel.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await prepare(page);
});

test.afterAll(async () => {
  await page.close();
});

for (const scenario of CASES) {
  test.describe(scenario.name, () => {
    const backdrop = premultiply(scenario.backdrop);
    const source = premultiply(scenario.source);

    for (const mode of ALL_MODES) {
      test(mode, async () => {
        const got = await compositePixel(page, backdrop, source, mode);
        const expected = composite(
          mode,
          straighten(backdrop),
          backdrop[3] / 255,
          straighten(source),
          source[3] / 255,
        );

        // Une unité de tolérance : le GPU arrondit en virgule flottante simple
        // là où la référence travaille en double précision.
        expect(Math.abs(got[0]! - expected[0]!)).toBeLessThanOrEqual(1);
        expect(Math.abs(got[1]! - expected[1]!)).toBeLessThanOrEqual(1);
        expect(Math.abs(got[2]! - expected[2]!)).toBeLessThanOrEqual(1);
        expect(Math.abs(got[3]! - expected[3]!)).toBeLessThanOrEqual(1);
      });
    }
  });
}

/**
 * Les valeurs chiffrées par l'amont dans le commit qui ajoute ces modes
 * (`09a65db`) : un gris à 80 % sur un gris à 40 %.
 *
 * Elles ne passent **pas** par la référence TypeScript. Si une formule de la
 * référence était mal recopiée, le shader et la référence pourraient se
 * tromper ensemble ; ces nombres-là viennent d'ailleurs — de Photoshop, selon
 * l'amont.
 */
test.describe('valeurs chiffrées par l’amont', () => {
  const grey = (value: number): [number, number, number, number] => [value, value, value, 255];
  const GREY_40 = grey(102);
  const GREY_80 = grey(204);

  const EXPECTED: readonly (readonly [BlendMode, number])[] = [
    ['linearBurn', 0.2],
    ['pinLight', 0.6],
    ['hardLight', 0.761],
    ['exclusion', 0.561],
    ['divide', 0.502],
  ];

  for (const [mode, value] of EXPECTED) {
    test(`80 % sur 40 % en ${mode} donne ${value}`, async () => {
      const got = await compositePixel(page, GREY_40, GREY_80, mode);
      expect(Math.abs(got[0]! / 255 - value)).toBeLessThanOrEqual(0.002);
    });
  }

  /** L'ordre des opérandes : c'est le fond moins la source, jamais l'inverse. */
  test('Soustraction retire la source du fond, pas l’inverse', async () => {
    expect((await compositePixel(page, GREY_80, GREY_40, 'subtract'))[0]).toBe(102);
    expect((await compositePixel(page, GREY_40, GREY_80, 'subtract'))[0]).toBe(0);
  });

  test('Division divise le fond par la source, pas l’inverse', async () => {
    expect((await compositePixel(page, GREY_40, GREY_80, 'divide'))[0]).toBe(128);
    expect((await compositePixel(page, GREY_80, GREY_40, 'divide'))[0]).toBe(255);
  });
});
