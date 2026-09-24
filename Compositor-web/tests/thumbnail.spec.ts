import { expect, test, type Page } from '@playwright/test';

/**
 * Traduction de `CanvasThumbnailTests` : la miniature montre **le canevas
 * entier**, le calque posé là où il est.
 *
 * Le Swift lit une image à densité 2 ; ces tests tournent à densité 1, donc
 * ses coordonnées sont divisées par deux : (4, 4) devient (2, 2), (60, 30)
 * devient (30, 15).
 */

test.describe.configure({ mode: 'serial' });

let page: Page;

/** Canevas 400 × 200, un calque rouge 100 × 100 en haut à gauche, et un calque vide. */
const setUp = (): Promise<void> =>
  page.evaluate(() => {
    const { documentStore } = (window as never as {
      __compositor: {
        documentStore: {
          getState(): { assets: { add(b: unknown): string } };
          setState(s: unknown): void;
        };
      };
    }).__compositor;
    const data = new Uint8ClampedArray(100 * 100 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([255, 0, 0, 255], i);
    const red = documentStore.getState().assets.add({ width: 100, height: 100, data, isOpaque: true });
    const transform = (width: number, height: number) => ({
      origin: { x: 0, y: 0 }, size: { width, height }, radians: 0, flipX: false, flipY: false, sampling: 'linear',
    });
    const base = { isVisible: true, parentId: null, isGroup: false, opacity: 1, blendMode: 'normal' };
    documentStore.setState({
      document: {
        id: 'v', width: 400, height: 200, resolution: 72,
        layers: [
          { ...base, id: 'vide', name: 'vide', asset: null, transform: transform(400, 200) },
          { ...base, id: 'rouge', name: 'rouge', asset: red, transform: transform(100, 100) },
        ],
      },
      activeLayerId: 'rouge',
      selectedLayerIds: ['rouge'],
    });
  });

/** Un pixel RGBA de la miniature du calque nommé. */
const pixel = (name: string, x: number, y: number): Promise<number[]> =>
  page.evaluate(
    ({ name, x, y }) => {
      const row = [...document.querySelectorAll('[role="option"]')].find((r) => r.textContent?.includes(name));
      const canvas = row!.querySelector('canvas[data-role="layer-thumbnail"]') as HTMLCanvasElement;
      return [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data];
    },
    { name, x, y },
  );

const thumbnail = (name: string) =>
  page.getByRole('option').filter({ hasText: name }).locator('canvas[data-role="layer-thumbnail"]');

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );
  await setUp();
  await page.waitForTimeout(200);
});

test.afterAll(async () => {
  await page.close();
});

test('la miniature prend la forme du canevas : 36 × 18 pour 400 × 200', async () => {
  const box = (await thumbnail('rouge').boundingBox())!;
  expect(box.width).toBe(36);
  expect(box.height).toBe(18);
});

test('les pixels du calque sont là où ils sont sur le canevas', async () => {
  expect(await pixel('rouge', 2, 2)).toEqual([255, 0, 0, 255]);
  expect((await pixel('rouge', 6, 6))[0]).toBe(255);
  // Le reste du canevas montre le damier.
  expect((await pixel('rouge', 30, 15))[0]).toBeLessThan(200);
  // Pas d'inversion verticale : le bas à gauche est vide.
  expect((await pixel('rouge', 2, 15))[0]).toBeLessThan(200);
});

test('un calque vide n’est que damier, opaque', async () => {
  const [r, g, b, a] = await pixel('vide', 2, 2);
  expect(a).toBe(255);
  expect(r).toBe(g);
  expect(g).toBe(b);
});

test('le damier est celui de l’original : gris 22 % et 32 %', async () => {
  const colours = new Set<number>();
  for (const [x, y] of [[1, 1], [7, 1], [13, 1], [1, 7]] as const) colours.add((await pixel('vide', x, y))[0]!);
  expect([...colours].sort()).toEqual([56, 82]);
});

test('seule la miniature du calque actif, seul sélectionné, porte la bordure d’accent', async () => {
  // Sans contour, le style vaut `none` et la largeur retombe sur `medium` :
  // seule la combinaison dit si une bordure se voit.
  const outline = (name: string) =>
    thumbnail(name).evaluate((c) => {
      const style = getComputedStyle(c);
      return style.outlineStyle === 'none' ? 'aucune' : `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`;
    });
  expect(await outline('rouge')).toMatch(/^2px solid rgb/);
  expect(await outline('vide')).toBe('aucune');

  // Deux calques sélectionnés : plus de bordure, comme `updateTarget`.
  await page.evaluate(() => {
    (window as never as {
      __compositor: { documentStore: { setState(s: unknown): void } };
    }).__compositor.documentStore.setState({ selectedLayerIds: ['rouge', 'vide'] });
  });
  expect(await outline('rouge')).toBe('aucune');
});
