import { expect, test, type Page } from '@playwright/test';

/**
 * Traductions de `LayerTests`, `LayerAppearanceTests` et `BlendShortcutTests`
 * qui ne dépendent ni des dossiers (T5) ni de l'annulation (T3).
 *
 * Les valeurs attendues sont **celles du Swift**, pas celles de notre
 * référence : elles viennent d'ailleurs, et c'est ce qui leur donne du poids.
 */

test.describe.configure({ mode: 'serial' });

let page: Page;

type Globals = {
  __compositor: {
    documentStore: {
      getState(): {
        assets: { add(b: unknown): string };
        document: { layers: { blendMode: string; opacity: number }[] } | null;
      };
      setState(s: unknown): void;
    };
    uiStore: { setState(s: unknown): void };
    compositor: { composite(d: unknown): Uint8ClampedArray };
  };
};

/**
 * Compose une pile de calques unis 8 × 8, du bas vers le haut, et rend le
 * pixel central. Chaque entrée : couleur RGBA, et au besoin mode, opacité,
 * visibilité, ou `null` pour un calque vide.
 */
interface Spec {
  readonly rgba: readonly number[] | null;
  readonly mode?: string;
  readonly opacity?: number;
  readonly visible?: boolean;
}

const centre = (specs: readonly Spec[]): Promise<number[]> =>
  page.evaluate((specs) => {
    const { documentStore, compositor } = (window as never as Globals).__compositor;
    const layers = specs.map((spec, index) => {
      let asset: string | null = null;
      if (spec.rgba !== null) {
        const data = new Uint8ClampedArray(8 * 8 * 4);
        for (let i = 0; i < data.length; i += 4) data.set(spec.rgba, i);
        asset = documentStore.getState().assets.add({ width: 8, height: 8, data, isOpaque: spec.rgba[3] === 255 });
      }
      return {
        id: `c${index}`, name: `c${index}`, asset, parentId: null, isGroup: false,
        isVisible: spec.visible ?? true, opacity: spec.opacity ?? 1, blendMode: spec.mode ?? 'normal',
        transform: { origin: { x: 0, y: 0 }, size: { width: 8, height: 8 }, radians: 0, flipX: false, flipY: false, sampling: 'nearest' },
      };
    });
    const document = { id: 'p', width: 8, height: 8, resolution: 72, layers };
    const pixels = compositor.composite(document);
    const at = (4 * 8 + 4) * 4;
    return [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!, pixels[at + 3]!];
  }, specs);

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];

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

/** `LayerTests.compositingHonorsVisibilityOrderAndBlankLayers`. */
test.describe('la composition respecte la visibilité, l’ordre et les calques vides', () => {
  test('le calque du dessus l’emporte', async () => {
    expect((await centre([{ rgba: RED }, { rgba: BLUE }]))[2]).toBeGreaterThan(242);
  });

  test('un calque masqué ne compte pas', async () => {
    expect((await centre([{ rgba: RED }, { rgba: BLUE, visible: false }]))[0]).toBeGreaterThan(242);
  });

  test('descendu sous l’autre, il est recouvert', async () => {
    expect((await centre([{ rgba: BLUE }, { rgba: RED }]))[0]).toBeGreaterThan(242);
  });

  test('un calque vide au sommet ne cache rien', async () => {
    expect((await centre([{ rgba: BLUE }, { rgba: RED }, { rgba: null }]))[0]).toBeGreaterThan(242);
  });
});

/**
 * `LayerAppearanceTests.blendModesAndOpacityMatchKnownPixels` : un gris à
 * 80 % sur un gris à 40 %, tolérance 0,02.
 */
test.describe('modes et opacité sur des pixels connus', () => {
  const GREY_40 = [102, 102, 102, 255];
  const GREY_80 = [204, 204, 204, 255];

  const KNOWN: readonly (readonly [string, number])[] = [
    ['normal', 0.8], ['multiply', 0.32], ['screen', 0.88], ['overlay', 0.64], ['darken', 0.4],
    ['lighten', 0.8], ['difference', 0.4], ['colorDodge', 1], ['colorBurn', 0.25],
  ];

  for (const [mode, expected] of KNOWN) {
    test(`${mode} donne ${expected}`, async () => {
      const [value, , , alpha] = await centre([{ rgba: GREY_40 }, { rgba: GREY_80, mode }]);
      expect(Math.abs(value! / 255 - expected)).toBeLessThan(0.02);
      expect(alpha).toBe(255);
    });
  }

  test('à 50 % d’opacité, Normal donne 0,6', async () => {
    const [value] = await centre([{ rgba: GREY_40 }, { rgba: GREY_80, opacity: 0.5 }]);
    expect(Math.abs(value! / 255 - 0.6)).toBeLessThan(0.02);
  });

  test('à 0 % d’opacité, le calque disparaît', async () => {
    const [value] = await centre([{ rgba: GREY_40 }, { rgba: GREY_80, opacity: 0 }]);
    expect(Math.abs(value! / 255 - 0.4)).toBeLessThan(0.02);
  });
});

/** Un calque gris actif, seul sélectionné, outil Déplacer. */
const oneLayer = (): Promise<void> =>
  page.evaluate(() => {
    const { documentStore, uiStore } = (window as never as Globals).__compositor;
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(204);
    const asset = documentStore.getState().assets.add({ width: 4, height: 4, data, isOpaque: true });
    documentStore.setState({
      document: {
        id: 'q', width: 4, height: 4, resolution: 72,
        layers: [{
          id: 'g', name: 'Gris', asset, parentId: null, isGroup: false, isVisible: true, opacity: 1, blendMode: 'normal',
          transform: { origin: { x: 0, y: 0 }, size: { width: 4, height: 4 }, radians: 0, flipX: false, flipY: false, sampling: 'linear' },
        }],
      },
      activeLayerId: 'g',
      selectedLayerIds: ['g'],
    });
    uiStore.setState({ tool: 'move' });
  });

const layer = (): Promise<{ blendMode: string; opacity: number }> =>
  page.evaluate(() => (window as never as Globals).__compositor.documentStore.getState().document!.layers[0]!);

/**
 * `LayerAppearanceTests.hoverPreviewIsTemporaryAndNeverChangesSavedState` :
 * survoler chaque mode ne touche jamais au document — pas même à son
 * identité, ce que regarderait l'historique.
 */
test('survoler les 24 modes ne modifie jamais le document', async () => {
  await oneLayer();
  await page.evaluate(() => {
    (window as never as { __avant: unknown }).__avant = (window as never as Globals).__compositor.documentStore.getState().document;
  });
  await page.getByRole('button', { name: 'Normal' }).click();
  const items = page.getByRole('menu').getByRole('menuitem');
  const count = await items.count();
  expect(count).toBe(24);
  for (let i = 0; i < count; i++) {
    await items.nth(i).hover();
    const unchanged = await page.evaluate(
      () =>
        (window as never as { __avant: unknown }).__avant ===
        (window as never as Globals).__compositor.documentStore.getState().document,
    );
    expect(unchanged).toBe(true);
  }
  await page.keyboard.press('Escape');
  expect((await layer()).blendMode).toBe('normal');

  // Choisir, en revanche, écrit.
  await page.getByRole('button', { name: 'Normal' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Produit' }).click();
  expect((await layer()).blendMode).toBe('multiply');
});

/**
 * `moveToolNumberKeysSetSelectedLayersOpacityAsOneUndo` : les chiffres ne
 * règlent l'opacité qu'avec l'outil Déplacer. `BlendShortcutTests` : Maj +/−
 * change le mode quel que soit l'outil.
 */
test.describe('les raccourcis selon l’outil', () => {
  for (const tool of ['brush', 'lasso'] as const) {
    test(`avec l’outil ${tool}, un chiffre ne touche pas l’opacité, Maj + change le mode`, async () => {
      await oneLayer();
      await page.evaluate((tool) => (window as never as Globals).__compositor.uiStore.setState({ tool }), tool);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('3');
      expect((await layer()).opacity).toBe(1);
      await page.keyboard.press('Shift+Equal');
      expect((await layer()).blendMode).toBe('darken');
    });
  }
});
