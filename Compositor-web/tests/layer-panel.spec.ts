import { expect, test, type Page } from '@playwright/test';

/**
 * Vignettes et raccourcis d'apparence, vérifiés dans l'application qui tourne.
 *
 * Le cas AZERTY est simulé explicitement : la touche marquée « 5 » y produit
 * `(` sans Maj. Un raccourci qui ne lirait que `event.key` passerait sur un
 * clavier QWERTY de test et échouerait chez un utilisateur français.
 */

test.describe.configure({ mode: 'serial' });

let page: Page;

interface State {
  opacity: number;
  blendMode: string;
}

const state = (): Promise<State> =>
  page.evaluate(() => {
    const { documentStore } = (window as never as {
      __compositor: { documentStore: { getState(): { document: { layers: State[] } } } };
    }).__compositor;
    const layer = documentStore.getState().document.layers[0]!;
    return { opacity: layer.opacity, blendMode: layer.blendMode };
  });

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

/** Presse une touche comme le ferait un clavier réel, avec sa touche physique. */
const press = (key: string, code: string, shiftKey = false): Promise<void> =>
  page.evaluate(
    ({ key, code, shiftKey }) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code, shiftKey, bubbles: true }));
    },
    { key, code, shiftKey },
  );

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
  // Laisse passer la fenêtre de 600 ms entre deux cas.
  await page.waitForTimeout(650);
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

test.describe('opacité au clavier', () => {
  test('un chiffre règle l’opacité', async () => {
    await press('5', 'Digit5');
    expect((await state()).opacity).toBeCloseTo(0.5);
  });

  test('deux chiffres rapides donnent un pourcentage précis', async () => {
    await press('5', 'Digit5');
    await press('5', 'Digit5');
    expect((await state()).opacity).toBeCloseTo(0.55);
  });

  test('zéro vaut 100 %', async () => {
    await press('3', 'Digit3');
    await page.waitForTimeout(650);
    await press('0', 'Digit0');
    expect((await state()).opacity).toBeCloseTo(1);
  });

  test('AZERTY : la touche marquée 5 produit « ( » et doit quand même marcher', async () => {
    await press('(', 'Digit5');
    expect((await state()).opacity).toBeCloseTo(0.5);
  });

  test('le pavé numérique marche aussi', async () => {
    await press('7', 'Numpad7');
    expect((await state()).opacity).toBeCloseTo(0.7);
  });

  test('un chiffre tapé dans un champ de texte ne touche pas l’opacité', async () => {
    await page.getByRole('textbox', { name: 'X', exact: true }).focus();
    await page.keyboard.press('5');
    expect((await state()).opacity).toBe(1);
    await page.getByRole('textbox', { name: 'X', exact: true }).blur();
  });

  /**
   * Le champ X bloque déjà la propagation de ses touches : le test précédent
   * passerait même sans la garde. Celui-ci l'isole, avec un champ ordinaire qui
   * laisse l'événement remonter jusqu'à `window`.
   */
  test('la garde protège un champ de texte qui ne bloque rien', async () => {
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'temoin-texte';
      document.body.appendChild(input);
    });
    await page.locator('#temoin-texte').focus();
    await page.keyboard.press('5');
    expect((await state()).opacity).toBe(1);
    await page.evaluate(() => document.getElementById('temoin-texte')?.remove());
  });

  test('avec une case à cocher sous le focus, le raccourci marche toujours', async () => {
    await page.getByLabel('Sélection auto', { exact: true }).focus();
    // Au clavier réel : l'événement doit partir de la case qui a le focus,
    // sinon ce test passerait même si l'exception était cassée.
    await page.keyboard.press('4');
    expect((await state()).opacity).toBeCloseTo(0.4);
  });
});

test.describe('mode de fusion au clavier', () => {
  // L'ordre est celui de Photoshop : après Normal vient Obscurcir
  // (`BlendShortcutTests`, depuis l'amont 1.2.2).
  test('Maj + avance d’un mode', async () => {
    await press('+', 'Equal', true);
    expect((await state()).blendMode).toBe('darken');
  });

  test('Maj − recule, en boucle jusqu’au dernier mode', async () => {
    await press('_', 'Minus', true);
    expect((await state()).blendMode).toBe('luminosity');
  });

  test('le pavé numérique avance et recule', async () => {
    await press('+', 'NumpadAdd');
    expect((await state()).blendMode).toBe('darken');
    await press('-', 'NumpadSubtract');
    expect((await state()).blendMode).toBe('normal');
  });

  test('un « + » sans Maj ne change rien', async () => {
    await press('=', 'Equal', false);
    expect((await state()).blendMode).toBe('normal');
  });
});

test.describe('menu des modes de fusion', () => {
  /**
   * Les 24 modes de l'amont 1.2.2, dans l'ordre de Photoshop, avec une ligne
   * entre chaque groupe (`LayerBlendMode.groups`).
   */
  test('24 modes en six groupes, séparés par cinq lignes', async () => {
    await page.getByRole('button', { name: 'Normal' }).click();
    // React Aria nomme le menu d'après le bouton qui l'ouvre, pas d'après son
    // `aria-label` : il n'y en a qu'un d'ouvert, pas besoin de le nommer.
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    const labels = await menu.getByRole('menuitem').allTextContents();
    expect(labels).toHaveLength(24);
    expect(labels.slice(0, 5)).toEqual([
      'Normal', 'Obscurcir', 'Produit', 'Densité couleur +', 'Densité linéaire +',
    ]);
    expect(labels.slice(-4)).toEqual(['Teinte', 'Saturation', 'Couleur', 'Luminosité']);
    await expect(menu.getByRole('separator')).toHaveCount(5);

    // Choisir un des nouveaux modes l'écrit bien dans le calque.
    await menu.getByRole('menuitem', { name: 'Lumière ponctuelle' }).click();
    expect((await state()).blendMode).toBe('pinLight');
  });
});
