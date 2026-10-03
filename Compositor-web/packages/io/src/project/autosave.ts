/**
 * Le fichier de sauvegarde automatique : un `.comp` (le zip de `packProject`)
 * précédé d'un petit en-tête. Il ne sort jamais du navigateur ; l'en-tête
 * garde ce que le paquet ne dit pas — le document était-il enregistré ?
 *
 * Disposition : `CWA1`, longueur de l'en-tête sur 4 octets (gros-boutiste),
 * en-tête JSON, puis le zip. Une seule écriture : jamais d'en-tête qui
 * décrirait un autre paquet que le sien.
 */

export interface AutosaveHeader {
  /** Le document avait-il des modifications non enregistrées ? */
  readonly modified: boolean;
  /** Date de l'écriture, en millisecondes depuis l'époque Unix. */
  readonly savedAt: number;
}

const MAGIC = [0x43, 0x57, 0x41, 0x31]; // « CWA1 »
const PREFIX = MAGIC.length + 4;

export const encodeAutosave = (header: AutosaveHeader, project: Uint8Array): Uint8Array => {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(PREFIX + json.length + project.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(MAGIC.length, json.length);
  out.set(json, PREFIX);
  out.set(project, PREFIX + json.length);
  return out;
};

/** `null` si les octets ne sont pas une sauvegarde automatique lisible. */
export const decodeAutosave = (bytes: Uint8Array): { header: AutosaveHeader; project: Uint8Array } | null => {
  if (bytes.length < PREFIX || MAGIC.some((byte, i) => bytes[i] !== byte)) return null;
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(MAGIC.length);
  if (PREFIX + length > bytes.length) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(PREFIX, PREFIX + length))) as Partial<AutosaveHeader>;
    if (typeof header.modified !== 'boolean' || typeof header.savedAt !== 'number') return null;
    return {
      header: { modified: header.modified, savedAt: header.savedAt },
      project: bytes.subarray(PREFIX + length),
    };
  } catch {
    return null;
  }
};
