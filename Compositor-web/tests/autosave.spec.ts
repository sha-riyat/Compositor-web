import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { decodeAutosave } from '../packages/io/src/project/autosave.js';

/**
 * La sauvegarde automatique : un document modifié survit à un rechargement,
 * avec ses pixels et son calque actif, et reste « modifié » s'il l'était.
 */

type State = {
  document: { layers: { id: string; name: string; asset: string | null }[] } | null;
  activeLayerId: string | null;
  assets: { get(id: string): { data: Uint8ClampedArray } | undefined };
};
type Globals = {
  __compositor: {
    compositor?: unknown;
    documentStore: { getState(): State };
    historyStore: { getState(): { isModified: boolean; canUndo: boolean } };
  };
};

const open = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as Globals).__compositor?.compositor !== undefined);
};

/** Dépose un PNG aux alphas variés, comme depuis le bureau. */
const drop = (page: Page, name: string): Promise<void> =>
  page.evaluate(async (name) => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const context = canvas.getContext('2d')!;
    for (let x = 0; x < 32; x++) {
      context.fillStyle = `rgba(${x * 8}, ${255 - x * 8}, ${name.length * 30}, ${(x + 1) / 32})`;
      context.fillRect(x, 0, 1, 24);
    }
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], `${name}.png`, { type: 'image/png' }));
    const root = document.getElementById('root')!.firstElementChild!;
    root.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    root.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, name);

/** Le document tel que l'utilisateur le voit : noms, calque actif, octets de chaque calque. */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const { documentStore, historyStore } = (window as never as Globals).__compositor;
    const s = documentStore.getState();
    return {
      names: s.document?.layers.map((l) => l.name) ?? null,
      active: s.document?.layers.find((l) => l.id === s.activeLayerId)?.name ?? null,
      pixels: s.document?.layers.map((l) => (l.asset === null ? [] : [...s.assets.get(l.asset)!.data])) ?? [],
      modified: historyStore.getState().isModified,
      canUndo: historyStore.getState().canUndo,
    };
  });

/** Le fichier de sauvegarde, décodé : son en-tête et les noms de ses calques. */
const autosaved = async (page: Page) => {
  const bytes = await page.evaluate(async () => {
    try {
      const directory = await navigator.storage.getDirectory();
      const file = await (await directory.getFileHandle('autosave.cwa')).getFile();
      return [...new Uint8Array(await file.arrayBuffer())];
    } catch {
      return null;
    }
  });
  if (bytes === null) return null;
  const saved = decodeAutosave(new Uint8Array(bytes))!;
  const manifest = JSON.parse(new TextDecoder().decode(unzipSync(saved.project)['manifest.json'])) as {
    layers: { name: string }[];
  };
  return { modified: saved.header.modified, names: manifest.layers.map((l) => l.name) };
};

test('un document modifié revient après un rechargement, pixels et calque actif compris', async ({ page }) => {
  await open(page);
  await drop(page, 'premier');
  await drop(page, 'second');
  await expect.poll(() => autosaved(page)).toEqual({ modified: true, names: ['premier', 'second'] });
  const before = await snapshot(page);
  expect(before.pixels[0]!.length).toBe(32 * 24 * 4);

  await page.reload();
  await page.waitForFunction(() => (window as never as Globals).__compositor?.compositor !== undefined);
  await expect.poll(async () => (await snapshot(page)).names).toEqual(['premier', 'second']);
  const after = await snapshot(page);
  expect(after.active).toBe('second');
  expect(after.pixels).toEqual(before.pixels);
  // Rien ne l'a enregistré : il reste « modifié ». L'historique, lui, repart vierge.
  expect(after.modified).toBe(true);
  expect(after.canUndo).toBe(false);
  await expect(page.getByRole('status')).toHaveText('Document rétabli depuis la sauvegarde automatique.');
});

test('un document enregistré revient non modifié', async ({ page }) => {
  await open(page);
  await drop(page, 'image');
  await expect.poll(() => autosaved(page)).toEqual({ modified: true, names: ['image'] });
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Enregistrer' }).click()]);
  await expect.poll(() => autosaved(page)).toEqual({ modified: false, names: ['image'] });

  await page.reload();
  await expect.poll(async () => (await snapshot(page)).names).toEqual(['image']);
  expect((await snapshot(page)).modified).toBe(false);
});

test('annuler jusqu’à la page vide efface la sauvegarde', async ({ page }) => {
  await open(page);
  await drop(page, 'image');
  await expect.poll(() => autosaved(page)).not.toBeNull();
  await page.keyboard.press('Control+z');
  await expect.poll(() => autosaved(page)).toBeNull();

  await page.reload();
  await page.waitForFunction(() => (window as never as Globals).__compositor?.compositor !== undefined);
  await page.waitForTimeout(1000);
  expect((await snapshot(page)).names).toBeNull();
});

test('un second onglet ne reprend pas le document d’un onglet encore ouvert', async ({ page, context }) => {
  await open(page);
  await drop(page, 'image');
  await expect.poll(() => autosaved(page)).not.toBeNull();

  const other = await context.newPage();
  await open(other);
  await other.waitForTimeout(1000);
  expect((await snapshot(other)).names).toBeNull();
  // Modifier le second onglet n'écrase pas la sauvegarde du premier.
  await drop(other, 'autre');
  await other.waitForTimeout(1500);
  expect((await autosaved(page))!.names).toEqual(['image']);

  // Le premier fermé, le second reprend la main au rechargement.
  await page.close();
  await other.reload();
  await expect.poll(async () => (await snapshot(other)).names).toEqual(['image']);
});
