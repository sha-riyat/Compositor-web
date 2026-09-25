import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

/**
 * Non-régression : un long message — le refus d'un projet, par exemple —
 * faisait passer la barre d'état sur deux lignes, le zoom compris. Elle reste
 * sur une ligne ; le message se tronque et se lit en entier au survol.
 */
test('un long message ne casse pas la barre d’état', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );
  const footer = page.locator('footer').last();
  const height = (await footer.boundingBox())!.height;
  const zoom = footer.locator('span').first();
  const lineHeight = (await zoom.boundingBox())!.height;

  // Un projet avec un masque : refusé, avec un message d'une centaine de caractères.
  const id = '6BA7B810-9DAD-11D1-80B4-00C04FD430C8';
  const manifest = {
    colorSpace: 'sRGB', documentID: id, format: 'com.compositor.project', width: 10, height: 10, version: 9, resolution: 72,
    layers: [{
      id, name: 'Masqué', isVisible: true, isGroup: false, opacity: 1, blendMode: 'Normal', maskFile: `${id}.mask.png`, maskEnabled: true,
      transform: { origin: [0, 0], size: [10, 10], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' },
    }],
  };
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Ouvrir…' }).click()]);
  await chooser.setFiles({ name: 'Masque.comp', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) })) });

  const message = footer.getByRole('status');
  await expect(message).toContainText('masques');
  expect((await footer.boundingBox())!.height).toBe(height);
  expect((await zoom.boundingBox())!.height).toBe(lineHeight);
  await expect(message).toHaveAttribute('title', /Il n'a pas été ouvert/);
});
