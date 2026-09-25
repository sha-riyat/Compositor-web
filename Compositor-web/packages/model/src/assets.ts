import type { AssetId } from './layer.js';

/**
 * Les pixels d'un calque, côté CPU.
 *
 * **Invariant ④ — le CPU reste la source de vérité, le GPU est un cache.**
 * Ces octets sont ce que relisent l'export, la sauvegarde et les noyaux WASM.
 * Le `renderer` tient en parallèle un cache de textures indexé par `AssetId`,
 * qu'il peut vider à tout moment sans rien perdre.
 *
 * Format : RGBA 8 bits **prémultiplié**, octets dans l'ordre R, G, B, A, en
 * sRGB non linéaire. C'est exactement ce que produit le Swift
 * (`premultipliedLast` + `byteOrder32Big` + espace sRGB) et ce qu'attendent les
 * huit noyaux C.
 */
export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  /**
   * Tampon non partagé : `ImageData` refuse un `SharedArrayBuffer`. En T4, les
   * tuiles destinées aux workers auront leur propre type.
   */
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  /**
   * Vrai si aucun pixel n'est partiellement transparent. Calculé une fois à
   * l'import : la barre d'état s'en sert pour annoncer `sRGB · Transparent`
   * honnêtement, plutôt que de le supposer.
   */
  readonly isOpaque: boolean;
}

interface Entry {
  readonly buffer: PixelBuffer;
  /** Incrémentée à chaque écriture : les caches s'en servent pour s'invalider. */
  revision: number;
}

/**
 * Magasin de pixels. Le modèle de document ne contient que des `AssetId` ;
 * plusieurs instantanés d'historique partagent donc les mêmes pixels sans les
 * copier — c'est ce que fait `DocumentHistory.swift`.
 *
 * ## Durée de vie : par accessibilité
 *
 * Un actif vit tant que le document courant ou un instantané d'historique le
 * référence ; `sweep` libère les autres. C'est l'équivalent de l'ARC sur les
 * `CGImage` de l'original. Un comptage de références manuel existait, mais
 * aucun appelant ne le tenait à jour : les pixels d'un calque supprimé n'étaient
 * jamais libérés.
 */
export class AssetStore {
  #entries = new Map<AssetId, Entry>();
  #nextId = 1;

  add(buffer: PixelBuffer): AssetId {
    const id = `asset-${this.#nextId++}`;
    this.#entries.set(id, { buffer, revision: 1 });
    return id;
  }

  get(id: AssetId): PixelBuffer | undefined {
    return this.#entries.get(id)?.buffer;
  }

  revision(id: AssetId): number {
    return this.#entries.get(id)?.revision ?? 0;
  }

  /** À appeler après avoir écrit dans `data`, pour que les caches se refassent. */
  touch(id: AssetId): void {
    const entry = this.#entries.get(id);
    if (entry !== undefined) entry.revision++;
  }

  /** Libère tout actif absent de `reachable`. Rend le nombre d'actifs libérés. */
  sweep(reachable: ReadonlySet<AssetId>): number {
    let freed = 0;
    for (const id of [...this.#entries.keys()]) {
      if (reachable.has(id)) continue;
      this.#entries.delete(id);
      freed++;
    }
    return freed;
  }

  /** Taille en octets d'un actif, `0` s'il n'existe plus. */
  bytesOf(id: AssetId): number {
    return this.#entries.get(id)?.buffer.data.byteLength ?? 0;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Octets détenus, pour le budget mémoire (le GPU n'est pas interrogeable). */
  get byteLength(): number {
    let total = 0;
    for (const entry of this.#entries.values()) total += entry.buffer.data.byteLength;
    return total;
  }

  clear(): void {
    this.#entries.clear();
  }
}

export const createPixelBuffer = (width: number, height: number): PixelBuffer => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
  isOpaque: false,
});

/** Un seul balayage des alphas — quelques millisecondes même en 4096². */
export const isFullyOpaque = (data: Uint8ClampedArray): boolean => {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return false;
  }
  return true;
};
