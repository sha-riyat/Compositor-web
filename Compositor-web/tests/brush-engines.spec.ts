import { expect, test, type Page } from '@playwright/test';

/**
 * Le GPU peint comme le processeur.
 *
 * Le moteur processeur est la référence : les traductions des tests Swift le
 * vérifient en Node (`brush.test.ts`). Ici, dans le navigateur, les mêmes
 * chemins passent par les deux moteurs, et leurs rasters sont comparés tuile
 * par tuile, octet par octet. Seul écart admis : la pointe douce intègre par
 * Gauss-Legendre sur le GPU, comme l'original, et par une table sur le
 * processeur. Mesuré : 1 niveau sur 255 au plus ; toléré : 1 pour la pointe
 * dure, 2 pour la douce.
 */

type Settings = { diameter: number; hardness: number; red: number; green: number; blue: number; opacity: number };
type Scenario = {
  readonly name: string;
  readonly settings: Settings;
  readonly points: readonly (readonly [number, number])[];
  readonly layer?: { rotation: number; flipX: boolean; scale: number };
  /** Le calque déborde du canevas : la peinture doit s'arrêter au bord. */
  readonly overhang?: boolean;
};

/** Des échantillons tous les `step` pixels, comme `BrushIntersectionTests.trace`. */
const dense = (points: readonly (readonly [number, number])[], step: number): [number, number][] => {
  const out: [number, number][] = [[points[0]![0], points[0]![1]]];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const count = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= count; k++) out.push([ax + ((bx - ax) * k) / count, ay + ((by - ay) * k) / count]);
  }
  return out;
};

const scenarios: Scenario[] = [
  { name: 'dure, un trait', settings: { diameter: 40, hardness: 1, red: 1, green: 0, blue: 0, opacity: 1 }, points: [[20, 40], [580, 40]] },
  { name: 'dure, translucide, qui repasse', settings: { diameter: 20, hardness: 1, red: 1, green: 0, blue: 0, opacity: 0.5 }, points: [[20, 40], [180, 40], [20, 40], [180, 40], [100, 40]] },
  { name: 'douce, un dépôt', settings: { diameter: 40, hardness: 0, red: 1, green: 0, blue: 0, opacity: 1 }, points: [[40, 40]] },
  {
    name: 'douce, croisements à 40 %',
    settings: { diameter: 120, hardness: 0, red: 1, green: 1, blue: 1, opacity: 0.4 },
    points: [[300, 60], [300, 280], [520, 280], [520, 170], [80, 170]],
  },
  { name: 'mi-dure, rapide', settings: { diameter: 90, hardness: 0.5, red: 0.2, green: 0.7, blue: 1, opacity: 0.8 }, points: [[30, 30], [560, 90], [300, 270], [60, 250]] },
  {
    name: 'douce, opaque, dense, qui se croise',
    settings: { diameter: 120, hardness: 0, red: 1, green: 1, blue: 1, opacity: 1 },
    points: dense([[300, 40], [300, 280], [540, 280], [540, 160], [60, 160]], 12),
  },
  {
    name: 'mi-douce, à travers le bord du canevas',
    settings: { diameter: 80, hardness: 0.4, red: 1, green: 0.5, blue: 0, opacity: 1 },
    points: dense([[-40, 150], [300, -30], [640, 150], [300, 330]], 10),
    overhang: true,
  },
  {
    name: 'douce, calque tourné, étiré, retourné, sur une image',
    settings: { diameter: 70, hardness: 0.3, red: 0, green: 0.4, blue: 0.9, opacity: 0.9 },
    points: [[60, 60], [500, 120], [420, 260], [120, 220]],
    layer: { rotation: 23, flipX: true, scale: 1.7 },
  },
];

/** Les deux moteurs sur le même chemin ; rend l'écart maximal et le nombre d'octets qui diffèrent. */
const compare = (page: Page, scenario: Scenario) =>
  page.evaluate((scenario) => {
    type Raster = { tiles: Map<number, Uint8ClampedArray> } | null;
    type Brush = {
      preferGpu: boolean;
      engine: string;
      start(layer: string, asset: string | null, target: unknown, settings: unknown): {
        append(p: { x: number; y: number }): void;
        present(): void;
        finish(): { complete(): Raster };
        cancel(): void;
      };
    };
    const { compositor, documentStore } = (window as never as {
      __compositor: { compositor: { brush: Brush }; documentStore: { getState(): { assets: { add(b: unknown): string } } } };
    }).__compositor;
    const width = 600;
    const height = 300;
    let asset: string | null = null;
    let source: unknown = null;
    let transform = { origin: { x: 0, y: 0 }, size: { width, height }, rotation: 0, flipX: false, flipY: false, sampling: 'high' };
    if (scenario.layer !== undefined) {
      // Une image en dégradé, placée tournée, étirée et retournée.
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) data.set([(i % width) % 256, Math.floor(i / width) % 256, 120, 255], i * 4);
      source = { width, height, data, isOpaque: true };
      asset = documentStore.getState().assets.add(source);
      transform = {
        origin: { x: 40, y: -30 },
        size: { width: width / scenario.layer.scale, height: height * 0.8 },
        rotation: scenario.layer.rotation,
        flipX: scenario.layer.flipX,
        flipY: false,
        sampling: 'high',
      };
    }
    if (scenario.overhang === true) {
      transform = { ...transform, origin: { x: -60, y: -60 }, size: { width: width + 120, height: height + 120 } };
    }
    const target = { width, height, source, transform, canvas: { width, height } };
    const paint = (gpu: boolean): { raster: Raster; engine: string } => {
      compositor.brush.preferGpu = gpu;
      const engine = compositor.brush.engine;
      const stroke = compositor.brush.start('comparaison', asset, target, scenario.settings);
      for (const [x, y] of scenario.points) {
        stroke.append({ x, y });
        stroke.present();
      }
      const raster = stroke.finish().complete();
      stroke.cancel();
      return { raster, engine };
    };
    const gpu = paint(true);
    const cpu = paint(false);
    compositor.brush.preferGpu = true;
    let max = 0;
    let differing = 0;
    let painted = 0;
    const keys = [...(cpu.raster?.tiles.keys() ?? [])].sort();
    const sameKeys = JSON.stringify(keys) === JSON.stringify([...(gpu.raster?.tiles.keys() ?? [])].sort());
    for (const key of keys) {
      const a = cpu.raster!.tiles.get(key)!;
      const b = gpu.raster!.tiles.get(key)!;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i]! - b[i]!);
        if (d > 0) differing++;
        if (d > max) max = d;
        if (i % 4 === 3 && a[i]! > 0) painted++;
      }
    }
    return { engines: [gpu.engine, cpu.engine], sameKeys, max, differing, painted };
  }, scenario);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined);
});

for (const scenario of scenarios) {
  test(`le GPU peint comme le processeur : ${scenario.name}`, async ({ page }) => {
    const result = await compare(page, scenario);
    console.log(`ÉCART ${scenario.name} : ${JSON.stringify(result)}`);
    expect(result.engines).toEqual(['gpu', 'cpu']);
    expect(result.sameKeys).toBe(true);
    expect(result.painted).toBeGreaterThan(200);
    expect(result.max).toBeLessThanOrEqual(scenario.settings.hardness >= 1 ? 1 : 2);
  });
}
