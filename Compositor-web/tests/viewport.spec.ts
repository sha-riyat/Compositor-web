import { expect, test } from '@playwright/test';

/**
 * Non-régression du cadrage à échelle nulle.
 *
 * Un import pendant que la zone de canevas n'avait pas de taille — panneau
 * masqué, fenêtre réduite, démarrage — cadrait sur un rectangle de 0 × 0 et
 * fixait l'échelle à zéro. Le document devenait invisible.
 *
 * Le cadrage doit maintenant **attendre** la première taille réelle.
 */
test('un import sans zone visible est cadré dès que la zone apparaît', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );

  const scale = (): Promise<number> =>
    page.evaluate(
      () =>
        (window as never as {
          __compositor: { uiStore: { getState(): { viewport: { scale: number } } } };
        }).__compositor.uiStore.getState().viewport.scale,
    );

  // La zone de canevas n'a aucune taille au moment de l'import.
  await page.evaluate(async () => {
    (document.querySelector('main') as HTMLElement).style.display = 'none';
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 900;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ff9500';
    context.fillRect(0, 0, 1600, 900);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'aveugle.png', { type: 'image/png' }));
    const root = document.getElementById('root')!.firstElementChild!;
    root.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer }));
    root.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
  await page.waitForFunction(
    () =>
      (window as never as {
        __compositor: { documentStore: { getState(): { document: unknown } } };
      }).__compositor.documentStore.getState().document !== null,
  );

  // Tant que la zone est cachée : jamais d'échelle nulle.
  expect(await scale()).toBeGreaterThan(0);

  // La zone réapparaît : le cadrage se fait à ce moment-là.
  await page.evaluate(() => {
    (document.querySelector('main') as HTMLElement).style.display = '';
  });

  const expected = await page.evaluate(() => {
    const rect = document.querySelector('canvas[data-role="document"]')!.getBoundingClientRect();
    return Math.min(1, Math.min(rect.width / 1600, rect.height / 900) * 0.9);
  });

  await expect.poll(scale, { timeout: 3000 }).toBeCloseTo(expected, 3);
  expect(expected).toBeLessThan(1);
});
