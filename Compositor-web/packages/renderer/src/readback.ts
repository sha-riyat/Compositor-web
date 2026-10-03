import { replaceTiles, type RasterHandoff, type StrokeTarget, type TiledRaster, type TileRect } from '@compositor/model';

/**
 * La relecture des tuiles d'un trait peint par le GPU, en plusieurs fois.
 *
 * Mesuré sur la machine de l'utilisateur (Chrome, ANGLE sur Direct3D 11) :
 * relire d'un bloc les 51 tuiles d'un trait de 300 px bloquait 85 à 155 ms ;
 * une tuile se copie en 1,6 à 2,8 ms. Au relâchement, les tuiles partent donc
 * dans un tampon du GPU, sans attendre ; les images suivantes en copient
 * quelques-unes chacune, dans un budget de temps. Le document ne change
 * qu'une fois toutes copiées : le processeur reste la référence.
 */
export class TileReadback implements RasterHandoff {
  readonly #gl: WebGL2RenderingContext;
  readonly #target: StrokeTarget;
  readonly #tiles: readonly (readonly [number, TileRect])[];
  readonly #offsets: number[] = [];
  readonly #copied = new Map<number, Uint8ClampedArray<ArrayBuffer>>();
  #buffer: WebGLBuffer | null;
  #fence: WebGLSync | null;
  #result: TiledRaster | null | undefined = undefined;

  constructor(
    gl: WebGL2RenderingContext,
    framebuffer: WebGLFramebuffer,
    texture: WebGLTexture,
    tiles: readonly (readonly [number, TileRect])[],
    target: StrokeTarget,
  ) {
    this.#gl = gl;
    this.#target = target;
    this.#tiles = tiles;
    let total = 0;
    for (const [, rect] of tiles) {
      this.#offsets.push(total);
      total += rect.width * rect.height * 4;
    }
    this.#buffer = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.#buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, Math.max(4, total), gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    tiles.forEach(([, rect], i) => {
      gl.readPixels(rect.x, rect.y, rect.width, rect.height, gl.RGBA, gl.UNSIGNED_BYTE, this.#offsets[i]!);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.#fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  step(budgetMs: number): TiledRaster | null | undefined {
    if (this.#result !== undefined) return this.#result;
    const gl = this.#gl;
    // Tant que le GPU n'a pas fini la copie, la lire ferait attendre : on repassera.
    if (this.#fence !== null && gl.clientWaitSync(this.#fence, 0, 0) === gl.TIMEOUT_EXPIRED) return undefined;
    const start = performance.now();
    do this.#copyNext();
    while (this.#copied.size < this.#tiles.length && performance.now() - start < budgetMs);
    return this.#settle();
  }

  complete(): TiledRaster | null {
    while (this.#result === undefined && this.#copied.size < this.#tiles.length) this.#copyNext();
    return this.#settle() ?? null;
  }

  #copyNext(): void {
    const i = this.#copied.size;
    const entry = this.#tiles[i];
    if (entry === undefined) return;
    const [key, rect] = entry;
    const pixels = new Uint8ClampedArray(rect.width * rect.height * 4);
    const gl = this.#gl;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.#buffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, this.#offsets[i]!, pixels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.#copied.set(key, pixels);
  }

  #settle(): TiledRaster | null | undefined {
    if (this.#copied.size < this.#tiles.length) return undefined;
    const gl = this.#gl;
    if (this.#fence !== null) gl.deleteSync(this.#fence);
    gl.deleteBuffer(this.#buffer);
    this.#fence = null;
    this.#buffer = null;
    this.#result =
      this.#tiles.length === 0 ? null : replaceTiles(this.#target.source, this.#target.width, this.#target.height, this.#copied);
    return this.#result;
  }
}
