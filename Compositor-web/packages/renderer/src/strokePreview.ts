import type { AssetId, LayerId } from '@compositor/model';
import { tileRect } from '@compositor/model';
import { setTextureParameters, type TextureCache } from './textures.js';

/**
 * L'aperçu d'un trait en cours. Le document ne change qu'au relâchement,
 * comme dans l'original ; d'ici là, le calque peint est dessiné depuis une
 * texture à part, où seules les tuiles touchées sont téléversées à chaque
 * mise à jour — jamais tout le calque.
 *
 * Au relâchement, cette texture contient exactement le raster produit : le
 * cache la reprend sous le nouvel actif, sans rien retéléverser.
 */

export interface PreviewTexture {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
}

export class StrokePreview {
  readonly #gl: WebGL2RenderingContext;
  readonly #textures: TextureCache;
  #layerId: LayerId | null = null;
  #entry: PreviewTexture | null = null;
  #mipmapsStale = false;

  constructor(gl: WebGL2RenderingContext, textures: TextureCache) {
    this.#gl = gl;
    this.#textures = textures;
  }

  /** La texture d'aperçu du trait en cours, que le moteur GPU peint directement. */
  get target(): PreviewTexture | null {
    return this.#entry;
  }

  /** Le moteur GPU a écrit dans la texture : ses niveaux réduits sont à refaire. */
  markStale(): void {
    this.#mipmapsStale = true;
  }

  /** La texture qui remplace celle du calque `layerId`, s'il est en train d'être peint. */
  textureFor(layerId: LayerId): PreviewTexture | null {
    if (layerId !== this.#layerId || this.#entry === null) return null;
    if (this.#mipmapsStale) {
      const gl = this.#gl;
      gl.bindTexture(gl.TEXTURE_2D, this.#entry.texture);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.#mipmapsStale = false;
    }
    return this.#entry;
  }

  /**
   * Commence l'aperçu : une copie, faite sur le GPU, des pixels actuels du
   * calque — ou une texture transparente pour un calque vide.
   */
  begin(layerId: LayerId, asset: AssetId | null, width: number, height: number): void {
    this.cancel();
    const gl = this.#gl;
    const texture = gl.createTexture();
    if (texture === null) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    setTextureParameters(gl);

    const source = asset === null ? undefined : this.#textures.get(asset);
    if (source !== undefined && source.width === width && source.height === height) {
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, source.texture, 0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.#layerId = layerId;
    this.#entry = { texture, width, height };
  }

  /** Téléverse les tuiles recomposées depuis la dernière mise à jour. */
  update(tiles: ReadonlyMap<number, Uint8ClampedArray>): void {
    const entry = this.#entry;
    if (entry === null || tiles.size === 0) return;
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    for (const [key, tile] of tiles) {
      const rect = tileRect(entry.width, entry.height, key);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, rect.width, rect.height, gl.RGBA, gl.UNSIGNED_BYTE, tile);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    // Les niveaux réduits sont refaits une fois par image, au dessin.
    this.#mipmapsStale = true;
  }

  /** Termine l'aperçu ; sa texture devient celle de `asset`, l'actif que le trait a produit. */
  commit(asset: AssetId): void {
    const entry = this.#entry;
    if (entry === null) return;
    this.textureFor(this.#layerId!);
    this.#textures.adopt(asset, entry.texture, entry.width, entry.height);
    this.#entry = null;
    this.#layerId = null;
  }

  cancel(): void {
    if (this.#entry !== null) this.#gl.deleteTexture(this.#entry.texture);
    this.#entry = null;
    this.#layerId = null;
  }
}
