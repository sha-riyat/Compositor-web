import { expect, test, type Page } from '@playwright/test';

/**
 * Annuler et rétablir au clavier, dans l'application qui tourne.
 */

type Globals = {
  __compositor: {
    documentStore: {
      getState(): {
        document: { layers: { id: string; name: string }[] } | null;
        activeLayerId: string | null;
      };
    };
  };
};

const names = (page: Page): Promise<string[] | null> =>
  page.evaluate(
    () => (window as never as Globals).__compositor.documentStore.getState().document?.layers.map((l) => l.name) ?? null,
  );

const activeName = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const s = (window as never as Globals).__compositor.documentStore.getState();
    return s.document?.layers.find((l) => l.id === s.activeLayerId)?.name ?? null;
  });

const open = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );
};

/** Dépose un PNG uni, comme le ferait un glisser-déposer depuis le bureau. */
const drop = (page: Page, name: string): Promise<void> =>
  page.evaluate(async (name) => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 30;
    canvas.getContext('2d')!.fillRect(0, 0, 40, 30);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], `${name}.png`, { type: 'image/png' }));
    const root = document.getElementById('root')!.firstElementChild!;
    root.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    root.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, name);

test('annuler un import retire l’image, puis le document ; rétablir les ramène', async ({ page }) => {
  await open(page);
  await drop(page, 'premier');
  await expect.poll(() => names(page)).toEqual(['premier']);
  await drop(page, 'second');
  await expect.poll(() => names(page)).toEqual(['premier', 'second']);

  await page.keyboard.press('Control+z');
  expect(await names(page)).toEqual(['premier']);
  expect(await activeName(page)).toBe('premier');
  await page.keyboard.press('Control+z');
  expect(await names(page)).toBeNull();

  await page.keyboard.press('Control+Shift+Z');
  expect(await names(page)).toEqual(['premier']);
  // Ctrl+Y, la convention de Windows, rétablit aussi.
  await page.keyboard.press('Control+y');
  expect(await names(page)).toEqual(['premier', 'second']);
  expect(await activeName(page)).toBe('second');
});

test('annuler une suppression ramène le calque et sa sélection', async ({ page }) => {
  await open(page);
  await drop(page, 'bas');
  await drop(page, 'haut');
  await expect.poll(() => names(page)).toEqual(['bas', 'haut']);

  await page.getByRole('button', { name: 'Supprimer' }).click();
  expect(await names(page)).toEqual(['bas']);
  await page.keyboard.press('Control+z');
  expect(await names(page)).toEqual(['bas', 'haut']);
  expect(await activeName(page)).toBe('haut');
  await expect(page.getByRole('option', { name: /haut/ })).toHaveAttribute('aria-selected', 'true');
});

test('dans un champ de texte, Ctrl+Z reste l’annulation du champ', async ({ page }) => {
  await open(page);
  await drop(page, 'image');
  await expect.poll(() => names(page)).toEqual(['image']);

  // Un champ ordinaire, qui ne retient aucune touche : seule la garde de
  // l'historique peut empêcher Ctrl+Z d'annuler l'import.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'temoin-annulation';
    document.body.append(input);
  });
  await page.locator('#temoin-annulation').click();
  await page.keyboard.type('xyz');
  await page.keyboard.press('Control+z');
  expect(await names(page)).toEqual(['image']);
});
