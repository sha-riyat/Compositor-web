import { expect, test, type Page } from '@playwright/test';

/**
 * Le champ numérique, dans l'application qui tourne et au vrai clavier.
 *
 * Deux usages, deux façons d'appliquer — comme dans l'original :
 * - X, Y, L, H suivent la frappe (`TransformValueField`) ;
 * - le pourcentage d'opacité s'applique en quittant le champ
 *   (`LayerAppearanceControls`).
 */

test.describe.configure({ mode: 'serial' });

let page: Page;

interface Layer {
  opacity: number;
  transform: { origin: { x: number; y: number } };
}

const layer = (): Promise<Layer> =>
  page.evaluate(
    () =>
      (window as never as {
        __compositor: { documentStore: { getState(): { document: { layers: Layer[] } } } };
      }).__compositor.documentStore.getState().document.layers[0]!,
  );

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
    const data = new Uint8ClampedArray(64 * 64 * 4).fill(200);
    const asset = documentStore.getState().assets.add({ width: 64, height: 64, data, isOpaque: true });
    documentStore.setState({
      document: {
        id: 'n', width: 400, height: 300, resolution: 72,
        layers: [{
          id: 'c', name: 'c', asset, isVisible: true, parentId: null, isGroup: false,
          opacity: 1, blendMode: 'normal',
          transform: { origin: { x: 100, y: 50 }, size: { width: 64, height: 64 }, radians: 0, flipX: false, flipY: false, sampling: 'linear' },
        }],
      },
      activeLayerId: 'c',
      selectedLayerIds: ['c'],
    });
  });

const fieldX = () => page.getByRole('textbox', { name: 'X', exact: true });
const percent = () => page.getByRole('textbox', { name: 'Opacité en pourcentage' });

/** Remplace le contenu du champ comme le ferait quelqu'un : tout sélectionner, taper. */
const typeInto = async (field: ReturnType<typeof fieldX>, text: string): Promise<void> => {
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
};

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
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await reset();
  // Laisse passer la fenêtre de 600 ms des raccourcis d'opacité.
  await page.waitForTimeout(650);
});

test.describe('X, Y, L, H', () => {
  test('le calque suit la frappe, sans attendre qu’on quitte le champ', async () => {
    await typeInto(fieldX(), '1');
    expect((await layer()).transform.origin.x).toBe(1);
    await page.keyboard.type('50');
    expect((await layer()).transform.origin.x).toBe(150);
    await expect(fieldX()).toBeFocused();
  });

  test('un champ vidé n’envoie pas le calque à zéro', async () => {
    await typeInto(fieldX(), '');
    await page.keyboard.press('Backspace');
    expect((await layer()).transform.origin.x).toBe(100);
    await page.keyboard.press('Enter');
    await expect(fieldX()).toHaveValue('100');
  });

  test('flèches : un pas, dix avec Maj, et le champ montre la valeur', async () => {
    await fieldX().click();
    await page.keyboard.press('ArrowUp');
    expect((await layer()).transform.origin.x).toBe(101);
    await page.keyboard.press('Shift+ArrowUp');
    expect((await layer()).transform.origin.x).toBe(111);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect((await layer()).transform.origin.x).toBe(100);
    await expect(fieldX()).toHaveValue('100');
  });

  test('Échap libère le champ sans annuler — comme l’original', async () => {
    await typeInto(fieldX(), '42');
    await page.keyboard.press('Escape');
    await expect(fieldX()).not.toBeFocused();
    expect((await layer()).transform.origin.x).toBe(42);
  });
});

test.describe('pourcentage d’opacité', () => {
  test('le champ fait 44 px, suivi de « % »', async () => {
    const box = await percent().boundingBox();
    expect(box!.width).toBe(44);
    await expect(percent()).toHaveValue('100');
  });

  test('la valeur s’applique en quittant le champ, pas pendant la frappe', async () => {
    await typeInto(percent(), '55');
    expect((await layer()).opacity).toBe(1);
    await page.keyboard.press('Enter');
    expect((await layer()).opacity).toBeCloseTo(0.55, 5);
    await expect(percent()).not.toBeFocused();
  });

  /**
   * Un chiffre tapé ici ne doit pas passer par les raccourcis d'opacité : le
   * raccourci ferait de « 7 » 70 %, le champ en fait 7 %.
   */
  test('« 7 » tapé dans le champ donne 7 %, pas les 70 % du raccourci', async () => {
    await typeInto(percent(), '7');
    await page.keyboard.press('Escape');
    expect((await layer()).opacity).toBeCloseTo(0.07, 5);
  });

  test('un texte qui n’est pas un nombre rétablit la valeur', async () => {
    await typeInto(percent(), 'abc');
    await page.keyboard.press('Enter');
    expect((await layer()).opacity).toBe(1);
    await expect(percent()).toHaveValue('100');
  });

  test('les bornes 0 et 100 tiennent, au clavier comme à la frappe', async () => {
    await typeInto(percent(), '250');
    await page.keyboard.press('Enter');
    expect((await layer()).opacity).toBe(1);

    await typeInto(percent(), '5');
    await page.keyboard.press('Enter');
    await percent().click();
    await page.keyboard.press('Shift+ArrowDown');
    expect((await layer()).opacity).toBe(0);
    await expect(percent()).toHaveValue('0');
  });

  test('le curseur et le champ restent d’accord', async () => {
    await typeInto(percent(), '30');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('slider', { name: 'Opacité' })).toHaveValue('30');
  });
});
