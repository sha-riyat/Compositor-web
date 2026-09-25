import type { AssetId, AssetStore } from '@compositor/model';
import { LIMITS } from '@compositor/model';

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
    const buffer = this.#assets.get(id);
    if (buffer === undefined) return undefined;

    const revision = this.#assets.revision(id);
    const existing = this.#entries.get(id);
    if (existing !== undefined) {
      if (existing.revision === revision) return existing;
      this.#upload(existing.texture, buffer.width, buffer.height, buffer.data);
      existing.revision = revision;
      return existing;
    }

    const gl = this.#gl;
    const texture = gl.createTexture();
    if (texture === null) return undefined;
    this.#upload(texture, buffer.width, buffer.height, buffer.data);

    const entry: Entry = { texture, width: buffer.width, height: buffer.height, revision };
    this.#entries.set(id, entry);
    return entry;
  }

  #upload(
    texture: WebGLTexture,
    width: number,
    height: number,
    data: Uint8ClampedArray<ArrayBuffer>,
  ): void {
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // `RGBA8` et non `SRGB8_ALPHA8` : on compose dans l'espace où les octets
    // sont écrits, sans décodage vers le linéaire (invariant ①).
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
