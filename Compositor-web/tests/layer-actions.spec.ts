import { expect, test, type Page } from '@playwright/test';

/**
 * Les boutons du bas du panneau, et ce que l'original choisit à la place de
 * l'utilisateur : quel calque reste actif après une suppression.
 */

interface State {
  names: string[];
  active: string | null;
  selected: string[];
}

const state = (page: Page): Promise<State> =>
  page.evaluate(() => {
    const s = (window as never as {
      __compositor: {
        documentStore: {
          getState(): {
            document: { layers: { id: string; name: string }[] };
            activeLayerId: string | null;
            selectedLayerIds: string[];
          };
        };
      };
    }).__compositor.documentStore.getState();
    const name = (id: string | null) => s.document.layers.find((l) => l.id === id)?.name ?? null;
    return {
      names: s.document.layers.map((l) => l.name),
      active: name(s.activeLayerId),
      selected: s.selectedLayerIds.map((id) => name(id)!),
    };
  });

/** Trois calques vides, du bas vers le haut, le deuxième actif. */
const setUp = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );
  await page.evaluate(() => {
    const layer = (id: string) => ({
      id, name: id, asset: null, isVisible: true, parentId: null, isGroup: false, opacity: 1, blendMode: 'normal',
      transform: { origin: { x: 0, y: 0 }, size: { width: 800, height: 600 }, radians: 0, flipX: false, flipY: false, sampling: 'linear' },
    });
    (window as never as { __compositor: { documentStore: { setState(s: unknown): void } } }).__compositor.documentStore.setState({
      document: { id: 'a', width: 800, height: 600, resolution: 72, layers: [layer('L1'), layer('L2'), layer('L3')] },
      activeLayerId: 'L2',
      selectedLayerIds: ['L2'],
    });
  });
};

test('supprimer le calque actif rend actif celui qui prend sa place', async ({ page }) => {
  await setUp(page);
  await page.getByRole('button', { name: 'Supprimer' }).click();
  expect(await state(page)).toEqual({ names: ['L1', 'L3'], active: 'L3', selected: ['L3'] });
  await expect(page.getByRole('option', { name: /L3/ })).toHaveAttribute('aria-selected', 'true');

  // Au sommet, c'est le nouveau sommet ; puis la pile se vide.
  await page.getByRole('button', { name: 'Supprimer' }).click();
  expect(await state(page)).toEqual({ names: ['L1'], active: 'L1', selected: ['L1'] });
  await page.getByRole('button', { name: 'Supprimer' }).click();
  expect(await state(page)).toEqual({ names: [], active: null, selected: [] });
});
