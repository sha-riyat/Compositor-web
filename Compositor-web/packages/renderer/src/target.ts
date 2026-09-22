/**
 * Une cible de rendu hors écran : une texture et son tampon d'image.
 *
 * Les modes de fusion ont besoin de lire le fond pendant qu'ils écrivent, ce
 * que WebGL2 interdit sur une même cible. Deux de ces objets s'échangent donc
 * à chaque calque non-Normal.
 *
 * Le format est `RGBA8`, comme partout ailleurs : la composition se fait en
 * sRGB non linéaire (invariant ①).
 */
export class RenderTarget {
  #gl: WebGL2RenderingContext;
  #texture: WebGLTexture;
  #framebuffer: WebGLFramebuffer;
  #width = 0;
  #height = 0;

  constructor(gl: WebGL2RenderingContext) {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (texture === null || framebuffer === null) {
      throw new Error("Impossible d'allouer une cible de rendu");
    }
    this.#gl = gl;
    this.#texture = texture;
    this.#framebuffer = framebuffer;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  get texture(): WebGLTexture {
    return this.#texture;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  /** Réalloue la texture si la taille demandée a changé. */
  resize(width: number, height: number): void {
    if (this.#width === width && this.#height === height) return;
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, this.#texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.#width = width;
    this.#height = height;
  }

  /** Lie la cible et cale le viewport dessus. */
  bind(): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    gl.viewport(0, 0, this.#width, this.#height);
  }

  clear(): void {
    const gl = this.#gl;
    this.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Lève si la cible n'est pas complète, plutôt que de rendre du noir. */
  assertComplete(): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Cible de rendu incomplète (0x${status.toString(16)})`);
    }
  }

  dispose(): void {
    this.#gl.deleteFramebuffer(this.#framebuffer);
    this.#gl.deleteTexture(this.#texture);
  }
}
