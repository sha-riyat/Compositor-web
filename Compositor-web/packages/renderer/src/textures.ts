import type { AssetId, AssetStore, PixelSource } from '@compositor/model';
import { isTiled, LIMITS, tileRect } from '@compositor/model';

/**
 * Le cache de textures : **le GPU n'est qu'un cache** (invariant ④).
 *
 * Rien ici n'est une source de vérité. Toute entrée peut être jetée et
 * reconstruite depuis les octets CPU de l'`AssetStore`, qui restent la
 * référence pour l'export, la sauvegarde et les noyaux WASM.
 *
 * En T1, une texture par calque. Le passage au stockage pavé — indispensable
 * au-delà de `MAX_TEXTURE_SIZE`, et pour les 30 000 px que le format autorise —
 * a lieu en T4, avec la brosse.
 */

interface Entry {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
  /** Révision de l'asset au moment du téléversement. */
  revision: number;
}

export class TextureCache {
  #gl: WebGL2RenderingContext;
  #assets: AssetStore;
  #entries = new Map<AssetId, Entry>();
  #maxTextureSize: number;

  constructor(gl: WebGL2RenderingContext, assets: AssetStore) {
    this.#gl = gl;
    this.#assets = assets;
    this.#maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  }

  /** Ce que la carte accepte, borné par la limite que T1 s'impose. */
  get maxSide(): number {
    return Math.min(this.#maxTextureSize, LIMITS.maxSide);
  }

  get(id: AssetId): Entry | undefined {
    const source = this.#assets.source(id);
    if (source === undefined) return undefined;

    const revision = this.#assets.revision(id);
    const existing = this.#entries.get(id);
    if (existing !== undefined) {
      if (existing.revision === revision) return existing;
      this.#upload(existing.texture, source);
      existing.revision = revision;
      return existing;
    }

    const gl = this.#gl;
    const texture = gl.createTexture();
    if (texture === null) return undefined;
    this.#upload(texture, source);

    const entry: Entry = { texture, width: source.width, height: source.height, revision };
    this.#entries.set(id, entry);
    return entry;
  }

  /**
   * Reprend une texture déjà à jour sous un nouvel actif — celle de l'aperçu
   * d'un trait, qui contient exactement le raster qu'il vient de produire.
   * Sans cela, chaque relâchement retéléverserait tout le calque.
   */
  adopt(id: AssetId, texture: WebGLTexture, width: number, height: number): void {
    this.release(id);
    this.#entries.set(id, { texture, width, height, revision: this.#assets.revision(id) });
  }

  /**
   * Un raster tuilé n'est jamais assemblé pour le GPU : la base d'abord,
   * puis chaque tuile repeinte à sa place.
   */
  #upload(texture: WebGLTexture, source: PixelSource): void {
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const base = isTiled(source) ? source.base : source;
    // `RGBA8` et non `SRGB8_ALPHA8` : on compose dans l'espace où les octets
    // sont écrits, sans décodage vers le linéaire (invariant ①).
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      source.width,
      source.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      base === null ? null : new Uint8Array(base.data.buffer, base.data.byteOffset, base.data.byteLength),
    );
    if (isTiled(source)) {
      for (const [key, tile] of source.tiles) {
        const rect = tileRect(source.width, source.height, key);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, rect.width, rect.height, gl.RGBA, gl.UNSIGNED_BYTE, tile);
      }
    }
    setTextureParameters(gl);
    // La pyramide tient lieu des « halvings nets » de `DownsampleCache.swift` :
    // une réduction forte passe par des divisions par deux successives plutôt
    // que par un seul échantillonnage qui scintillerait.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Libère toute texture dont l'actif n'est pas dans `ids`. Le GPU ne garde
   * que ce que le document affiché utilise : un actif retenu par l'historique
   * sera retéléversé si une annulation le ramène.
   */
  retainOnly(ids: ReadonlySet<AssetId>): void {
    for (const id of [...this.#entries.keys()]) if (!ids.has(id)) this.release(id);
  }

  release(id: AssetId): void {
    const entry = this.#entries.get(id);
    if (entry === undefined) return;
    this.#gl.deleteTexture(entry.texture);
    this.#entries.delete(id);
  }

  clear(): void {
    for (const entry of this.#entries.values()) this.#gl.deleteTexture(entry.texture);
    this.#entries.clear();
  }
}

export const setTextureParameters = (gl: WebGL2RenderingContext): void => {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};
