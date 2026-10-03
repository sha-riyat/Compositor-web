import { expect, test, type Page } from '@playwright/test';

/**
 * Le banc de la brosse, calqué sur `BrushPerformanceTests.fourKInteractiveStroke` :
 * un calque de 4000 × 3000, vide puis opaque, deux traits de 120 mises à jour
 * de 40 px, vue cadrée sur le document. Brosses de 40 et 300 px.
 *
 * Il **mesure** et affiche ; il n'échoue que si rien n'a été mesuré. La règle
 * d'arrêt de T4 se juge sur ces chiffres (SHA-93), pas sur un seuil codé ici :
 * une machine chargée ne doit pas faire échouer la suite.
 */

type Summary = { count: number; median: number; p95: number };
type Globals = {
  __compositor: {
    compositor?: unknown;
    documentStore: { getState(): { assets: { add(b: unknown): string } }; setState(s: unknown): void };
    uiStore: { setState(s: unknown): void };
    gestureTimings: { inputToFrame: number[]; update: number[]; render: number[] };
    resetGestureTimings(): void;
    summarize(series: number[]): Summary;
  };
};

const WIDTH = 4000;
const HEIGHT = 3000;

const setUp = async (page: Page, opaque: boolean, diameter: number) => {
  await page.evaluate(
    ({ opaque, diameter, WIDTH, HEIGHT }) => {
      const { documentStore, uiStore } = (window as never as Globals).__compositor;
      let asset: string | null = null;
      if (opaque) {
        const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
        for (let i = 3; i < data.length; i += 4) data[i] = 255;
        asset = documentStore.getState().assets.add({ width: WIDTH, height: HEIGHT, data, isOpaque: true });
      }
      documentStore.setState({
        document: {
          id: 'banc', width: WIDTH, height: HEIGHT, resolution: 72,
          layers: [{
            id: 'peint', name: 'Peint', asset, isVisible: true, parentId: null, isGroup: false, opacity: 1, blendMode: 'normal',
            transform: { origin: { x: 0, y: 0 }, size: { width: WIDTH, height: HEIGHT }, rotation: 0, flipX: false, flipY: false, sampling: 'high' },
          }],
        },
        activeLayerId: 'peint',
        selectedLayerIds: ['peint'],
      });
      uiStore.setState({ tool: 'brush', brush: { diameter, hardness: 1, red: 1, green: 1, blue: 1, opacity: 1 } });
    },
    { opaque, diameter, WIDTH, HEIGHT },
  );
};

/** Le document cadré dans la vue ; rend la fonction document → page. */
const fit = async (page: Page) => {
  const box = (await page.locator('canvas[data-role="document"]').boundingBox())!;
  const scale = Math.min(box.width / WIDTH, box.height / HEIGHT) * 0.95;
  const offsetX = (box.width - WIDTH * scale) / 2;
  const offsetY = (box.height - HEIGHT * scale) / 2;
  await page.evaluate((viewport) => (window as never as Globals).__compositor.uiStore.setState({ viewport }), { scale, offsetX, offsetY });
  return (x: number, y: number) => ({ x: box.x + offsetX + x * scale, y: box.y + offsetY + y * scale });
};

const bench = async (page: Page, opaque: boolean, diameter: number) => {
  await setUp(page, opaque, diameter);
  const toPage = await fit(page);
  await page.evaluate(() => (window as never as Globals).__compositor.resetGestureTimings());
  for (let pass = 0; pass < 2; pass++) {
    const x0 = 700 + pass * 200;
    const start = toPage(x0, 2800);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 120; i++) {
      const p = i <= 60 ? toPage(x0, 2800 - i * 40) : toPage(x0 + (i - 60) * 40, 400);
      await page.mouse.move(p.x, p.y);
    }
    await page.mouse.up();
  }
  return page.evaluate(() => {
    const { gestureTimings, summarize } = (window as never as Globals).__compositor;
    return {
      inputToFrame: summarize(gestureTimings.inputToFrame),
      update: summarize(gestureTimings.update),
      render: summarize(gestureTimings.render),
    };
  });
};

test('banc 4000 × 3000 : latence d’un trait, brosses de 40 et 300 px', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => (window as never as Globals).__compositor?.compositor !== undefined);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')!;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info === null ? 'inconnu' : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  });
  const rows: string[] = [`GPU : ${gpu}`];
  for (const opaque of [false, true]) {
    for (const diameter of [40, 300]) {
      const result = await bench(page, opaque, diameter);
      expect(result.update.count).toBeGreaterThan(100);
      const f = (s: Summary) => `${s.median.toFixed(2)} / ${s.p95.toFixed(2)} ms (${s.count})`;
      rows.push(
        `${opaque ? 'opaque' : 'vide  '} ${String(diameter).padStart(3)} px — entrée→image ${f(result.inputToFrame)} · mise à jour ${f(result.update)} · dessin ${f(result.render)}`,
      );
    }
  }
  console.log(`\nBANC BROSSE (médiane / 95ᵉ centile)\n${rows.join('\n')}`);
});
