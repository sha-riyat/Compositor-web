import { describe, expect, test } from 'vitest';
import { decodeAutosave, encodeAutosave } from './autosave.js';

/** Le conteneur de la sauvegarde automatique : l'en-tête et le paquet reviennent intacts. */
describe('le fichier de sauvegarde automatique', () => {
  const project = new Uint8Array([0x50, 0x4b, 3, 4, 9, 8, 7]);

  test('l’en-tête et le paquet reviennent à l’octet près', () => {
    const decoded = decodeAutosave(encodeAutosave({ modified: true, savedAt: 1_790_000_000_000 }, project));
    expect(decoded?.header).toEqual({ modified: true, savedAt: 1_790_000_000_000 });
    expect([...decoded!.project]).toEqual([...project]);
  });

  test('un paquet `.comp` nu, un fichier tronqué ou un en-tête faux sont refusés', () => {
    const bytes = encodeAutosave({ modified: false, savedAt: 1 }, project);
    expect(decodeAutosave(project)).toBeNull();
    expect(decodeAutosave(bytes.subarray(0, 12))).toBeNull();
    const broken = bytes.slice();
    broken[9] = 0x7b; // le JSON ne se lit plus
    expect(decodeAutosave(broken)).toBeNull();
    expect(decodeAutosave(new Uint8Array(0))).toBeNull();
  });

  test('un en-tête sans l’état « modifié » est refusé', () => {
    const json = new TextEncoder().encode('{"savedAt":1}');
    const bytes = new Uint8Array([0x43, 0x57, 0x41, 0x31, 0, 0, 0, json.length, ...json, ...project]);
    expect(decodeAutosave(bytes)).toBeNull();
  });
});
