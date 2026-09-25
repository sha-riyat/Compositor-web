import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/**
 * Ouvrir un `.comp` depuis l'interface : par le bouton, par Ctrl+O, par un
 * dépôt. Le document ouvert n'est remplacé que par un projet valide.
 */

type Globals = {
  __compositor: {
    documentStore: {
      getState(): {
        document: { width: number; layers: { id: string; name: string; opacity: number; blendMode: string }[] } | null;
        activeLayerId: string | null;
        assets: { add(b: unknown): string };
      };
      setState(s: unknown): void;
    };
    historyDetails(): { undoCount: number };
  };
};

const UUID = '3F2504E0-4F89-11D3-9A0C-0305E82C3301';

const start = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );
};

/** Un document d'un calque, enregistré ; rend le chemin du fichier téléchargé. */
const saved = async (page: Page): Promise<string> => {
  await page.evaluate((uuid) => {
    const { documentStore } = (window as never as Globals).__compositor;
    const asset = documentStore.getState().assets.add({
      width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(120), isOpaque: false,
    });
    documentStore.setState({
      document: {
        id: 'd', width: 320, height: 200, resolution: 72,
        layers: [{
          id: uuid, name: 'Enregistré', asset, isVisible: true, parentId: null, isGroup: false, opacity: 0.4, blendMode: 'screen',
          transform: { origin: { x: 5, y: 6 }, size: { width: 8, height: 8 }, radians: 0, flipX: false, flipY: false, sampling: 'high' },
        }],
      },
      activeLayerId: uuid,
      selectedLayerIds: [uuid],
    });
  }, UUID);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Enregistrer' }).click()]);
  return (await download.path())!;
};

const layerNames = (page: Page) =>
  page.evaluate(() => (window as never as Globals).__compositor.documentStore.getState().document?.layers.map((l) => l.name) ?? null);

/** Remplace le document par un autre, sans l'enregistrer. */
const replaceWithOther = (page: Page) =>
  page.evaluate(() => {
    (window as never as Globals).__compositor.documentStore.setState({
      document: { id: 'autre', width: 50, height: 50, resolution: 72, layers: [] },
      activeLayerId: null,
      selectedLayerIds: [],
    });
  });

test('enregistrer, puis rouvrir par le bouton, redonne le document', async ({ page }) => {
  await start(page);
  const path = await saved(page);
  await replaceWithOther(page);

  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Ouvrir…' }).click()]);
  await chooser.setFiles(path);
  await expect.poll(() => layerNames(page)).toEqual(['Enregistré']);

  const state = await page.evaluate(() => {
    const s = (window as never as Globals).__compositor.documentStore.getState();
    return { width: s.document!.width, layer: s.document!.layers[0], active: s.activeLayerId };
  });
  expect(state.width).toBe(320);
  expect(state.layer).toMatchObject({ id: UUID, opacity: 0.4, blendMode: 'screen' });
  expect(state.active).toBe(UUID);
  // Un projet ouvert part d'un historique vierge.
  expect(await page.evaluate(() => (window as never as Globals).__compositor.historyDetails().undoCount)).toBe(0);
  await expect(page.getByRole('option', { name: /Enregistré/ })).toHaveAttribute('aria-selected', 'true');
});

test('Ctrl+O ouvre le choix du fichier', async ({ page }) => {
  await start(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  expect(chooser.isMultiple()).toBe(false);
});

test('déposer un .comp l’ouvre', async ({ page }) => {
  await start(page);
  const bytes = [...(await readFile(await saved(page)))];
  await replaceWithOther(page);
  await page.evaluate((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'Affiche.comp'));
    const root = document.getElementById('root')!.firstElementChild!;
    root.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    root.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, bytes);
  await expect.poll(() => layerNames(page)).toEqual(['Enregistré']);
});

test('un fichier abîmé est refusé, et le document ouvert reste en place', async ({ page }) => {
  await start(page);
  await saved(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Ouvrir…' }).click()]);
  await chooser.setFiles({ name: 'Abîmé.comp', mimeType: 'application/zip', buffer: Buffer.from('ceci n’est pas un zip') });
  await expect(page.getByText(/n'est pas un projet Compositor valide/)).toBeVisible();
  expect(await layerNames(page)).toEqual(['Enregistré']);
});

test('avec des modifications non enregistrées, ouvrir demande confirmation', async ({ page }) => {
  await start(page);
  const path = await saved(page);
  // Une modification après l'enregistrement : le document redevient « modifié ».
  await page.getByRole('button', { name: 'Nouveau calque' }).click();

  page.once('dialog', (dialog) => void dialog.dismiss());
  const [refuse] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Ouvrir…' }).click()]);
  await refuse.setFiles(path);
  await page.waitForTimeout(300);
  expect(await layerNames(page)).toEqual(['Enregistré', 'Calque 1']);

  page.once('dialog', (dialog) => void dialog.accept());
  const [accept] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Ouvrir…' }).click()]);
  await accept.setFiles(path);
  await expect.poll(() => layerNames(page)).toEqual(['Enregistré']);
});
