import { expect, test, type Page } from '@playwright/test';

/**
 * Non-régression : désigner un calque le rend actif **et** seul sélectionné,
 * comme le setter d'`activeLayerID` dans `EditorSession.swift`.
 *
 * Deux chemins l'oubliaient — l'import et la sélection par un outil — et
 * laissaient un calque actif hors de la sélection : ligne non surlignée,
 * raccourcis d'opacité sans effet.
 */

interface Selection {
  active: string | null;
  selected: string[];
}

const selection = (page: Page): Promise<Selection> =>
  page.evaluate(() => {
    const state = (window as never as {
      __compositor: { documentStore: { getState(): { activeLayerId: string | null; selectedLayerIds: string[] } } };
    }).__compositor.documentStore.getState();
    return { active: state.activeLayerId, selected: [...state.selectedLayerIds] };
  });

const open = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );
};

test('un calque importé est actif et seul sélectionné', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    canvas.getContext('2d')!.fillRect(0, 0, 120, 80);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'importe.png', { type: 'image/png' }));
    const root = document.getElementById('root')!.firstElementChild!;
    root.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    root.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
  await expect(page.getByRole('option', { name: /importe/ })).toHaveAttribute('aria-selected', 'true');

  const { active, selected } = await selection(page);
  expect(active).not.toBeNull();
  expect(selected).toEqual([active]);

  // La conséquence visible : un chiffre règle l'opacité du calque importé.
  await page.keyboard.press('5');
  const opacity = await page.evaluate(
    () =>
      (window as never as {
        __compositor: { documentStore: { getState(): { document: { layers: { opacity: number }[] } } } };
      }).__compositor.documentStore.getState().document.layers.at(-1)!.opacity,
  );
  expect(opacity).toBeCloseTo(0.5, 5);
});

test('un clic en Sélection auto rend le calque touché seul sélectionné', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const { documentStore, uiStore } = (window as never as {
      __compositor: {
        documentStore: { getState(): { assets: { add(b: unknown): string } }; setState(s: unknown): void };
        uiStore: { setState(s: unknown): void };
      };
    }).__compositor;
    const solid = () =>
      documentStore.getState().assets.add({
        width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4).fill(255), isOpaque: true,
      });
    const layer = (id: string, x: number) => ({
      id, name: id, asset: solid(), isVisible: true, parentId: null, isGroup: false, opacity: 1, blendMode: 'normal',
      transform: { origin: { x, y: 0 }, size: { width: 100, height: 100 }, radians: 0, flipX: false, flipY: false, sampling: 'linear' },
    });
    documentStore.setState({
      document: { id: 's', width: 300, height: 100, resolution: 72, layers: [layer('gauche', 0), layer('droite', 200)] },
      // Deux calques sélectionnés au départ : le clic doit ramener à un seul.
      activeLayerId: 'gauche',
      selectedLayerIds: ['gauche', 'droite'],
    });
    uiStore.setState({ autoSelect: true, viewport: { scale: 1, offsetX: 0, offsetY: 0 } });
  });

  const box = (await page.locator('canvas[data-role="document"]').boundingBox())!;
  await page.mouse.click(box.x + 250, box.y + 50);

  expect(await selection(page)).toEqual({ active: 'droite', selected: ['droite'] });
});
