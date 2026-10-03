import { expect, test, type Page } from '@playwright/test';

/**
 * Les modifications non enregistrées se voient — le point de 5 px de
 * `ProjectTabs.swift`, une puce dans le titre de la page — et quitter la page
 * avec un document modifié demande confirmation.
 */

const open = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );
};

const drop = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 30;
    canvas.getContext('2d')!.fillRect(0, 0, 40, 30);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    const root = document.getElementById('root')!.firstElementChild!;
    root.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    root.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });

const dot = (page: Page) => page.getByRole('img', { name: 'Modifications non enregistrées' });

test('le point et la puce suivent l’état enregistré du document', async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle('Compositor');
  await expect(dot(page)).toHaveCount(0);

  await drop(page);
  await expect(dot(page)).toBeVisible();
  expect(await dot(page).evaluate((e) => [getComputedStyle(e).width, getComputedStyle(e).height])).toEqual(['5px', '5px']);
  await expect(page).toHaveTitle('• Sans titre — Compositor');

  await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  await expect(dot(page)).toHaveCount(0);
  await expect(page).toHaveTitle('Sans titre — Compositor');
  await expect(page.getByText('Sans titre', { exact: true })).toBeVisible();

  // Une modification après l'enregistrement rallume le point ; l'annuler
  // revient à l'état enregistré et l'éteint.
  await drop(page);
  await expect(dot(page)).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(dot(page)).toHaveCount(0);
  await expect(page).toHaveTitle('Sans titre — Compositor');
});

test('quitter la page avec un document modifié demande confirmation', async ({ page }) => {
  await open(page);
  await drop(page);
  await expect(dot(page)).toBeVisible();
  // Chrome n'avertit qu'une page avec laquelle on a interagi ; un dépôt réel en est une.
  await page.locator('footer').last().click();
  const dialog = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const shown = await dialog;
  expect(shown.type()).toBe('beforeunload');
  await shown.dismiss();
});

test('un document enregistré se quitte sans question', async ({ page }) => {
  await open(page);
  await drop(page);
  await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  await expect(dot(page)).toHaveCount(0);
  await page.locator('footer').last().click();
  let asked = false;
  page.on('dialog', (d) => {
    asked = true;
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  expect(asked).toBe(false);
});
