import { expect, test, type Page } from '@playwright/test';

/**
 * Vignettes du panneau de calques, vérifiées dans l'application qui tourne.
 */

test.describe.configure({ mode: 'serial' });

let page: Page;

/** Un calque rouge pur, sélectionné, opacité 100 %, mode Normal. */
const reset = (): Promise<void> =>
  page.evaluate(() => {
    const { documentStore } = (window as never as {
      __compositor: {
        documentStore: {
          getState(): { assets: { add(b: unknown): string } };
          setState(s: unknown): void;
        };
      };
    }).__compositor;
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([255, 0, 0, 255], i);
    const asset = documentStore.getState().assets.add({ width: 64, height: 64, data, isOpaque: true });
    documentStore.setState({
      document: {
        id: 't', width: 64, height: 64, resolution: 72,
        layers: [{
          id: 'rouge', name: 'rouge', asset, isVisible: true, parentId: null, isGroup: false,
          opacity: 1, blendMode: 'normal',
          transform: { origin: { x: 0, y: 0 }, size: { width: 64, height: 64 }, radians: 0, flipX: false, flipY: false, sampling: 'linear' },
        }],
      },
      activeLayerId: 'rouge',
      selectedLayerIds: ['rouge'],
    });
  });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );
});

test.afterAll(async () => {
  await page.close();
});

test.beforeEach(async () => {
  await reset();
});

test.describe('vignettes', () => {
  test('la vignette montre la couleur du calque, pas un carré vide', async () => {
    await page.waitForTimeout(200);
    const centre = await page.evaluate(() => {
      const canvas = document.querySelector('[role="option"] canvas') as HTMLCanvasElement | null;
      if (canvas === null) return null;
      const context = canvas.getContext('2d')!;
      return [...context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data];
    });
    expect(centre).not.toBeNull();
    expect(centre![0]).toBeGreaterThan(240);
    expect(centre![1]).toBeLessThan(15);
    expect(centre![2]).toBeLessThan(15);
  });
});
