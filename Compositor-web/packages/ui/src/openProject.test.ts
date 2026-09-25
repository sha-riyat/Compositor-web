import { describe, expect, test } from 'vitest';
import { filesFromDirectory, isProjectFile } from './openProject.js';

/**
 * Un dossier `.comp` glissé depuis le Finder arrive en `FileSystemDirectoryEntry`.
 * Un événement de dépôt synthétique ne sait pas en fabriquer : les entrées
 * sont simulées ici, avec la même interface à rappels que le navigateur,
 * lots de lecture compris — `readEntries` rend les entrées par paquets.
 */

type Entry = { isDirectory: boolean; name: string };

const file = (name: string, text: string) => ({
  isDirectory: false,
  isFile: true,
  name,
  file: (resolve: (f: File) => void) => resolve(new File([text], name)),
});

const directory = (name: string, children: Entry[], batch = 1) => ({
  isDirectory: true,
  isFile: false,
  name,
  createReader: () => {
    let offset = 0;
    return {
      readEntries: (resolve: (entries: Entry[]) => void) => {
        const next = children.slice(offset, offset + batch);
        offset += batch;
        resolve(next);
      },
    };
  },
});

describe('un dossier-paquet déposé', () => {
  test('tout le paquet est lu, sous-dossiers et lots compris', async () => {
    const root = directory('Affiche.comp', [
      file('manifest.json', '{"format":"com.compositor.project"}'),
      directory('images', [file('A.png', 'png-a'), file('B.png', 'png-b')]),
    ]);
    const files = await filesFromDirectory(root as unknown as FileSystemDirectoryEntry)();
    expect([...files.keys()].sort()).toEqual(['images/A.png', 'images/B.png', 'manifest.json']);
    expect(new TextDecoder().decode(await files.get('images/B.png')!())).toBe('png-b');
  });

  test('un dossier sans manifeste n’est pas un projet', async () => {
    const root = directory('Photos', [file('vacances.png', '')]);
    await expect(filesFromDirectory(root as unknown as FileSystemDirectoryEntry)()).rejects.toThrow(/manifest/);
  });
});

describe('ce qui s’ouvre comme un projet', () => {
  test('.comp et .zip, pas une image', () => {
    expect(isProjectFile(new File([], 'Sans titre.comp'))).toBe(true);
    expect(isProjectFile(new File([], 'Affiche.comp.ZIP'))).toBe(true);
    expect(isProjectFile(new File([], 'photo.png'))).toBe(false);
  });
});
