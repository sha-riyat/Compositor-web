import {
  createTip,
  tileRect,
  StrokePath,
  union,
  type AssetId,
  type BrushSettings,
  type PaintStroke,
  type PathUpdate,
  type RasterHandoff,
  type PixelRect,
  type Point,
  type Segment,
  type StrokeTarget,
  type TileRect,
} from '@compositor/model';
import { createProgram } from './context.js';
import { BRUSH_VERTEX_SOURCE, COMPOSE_FRAGMENT_SOURCE, DEPOSIT_FRAGMENT_SOURCE, MAX_SEGMENTS } from './brushShaders.js';
import type { StrokePreview } from './strokePreview.js';
import { TileReadback } from './readback.js';

/**
 * Un trait peint par le GPU — l'équivalent WebGL2 de `MetalBrushCoverage`.
 *
 * Le processeur ne fait que suivre le chemin et dire quelles tuiles il
 * touche ; les pixels, eux, sont calculés dans des textures. Une tuile
 * touchée a deux textures de densité en flottants (lue, puis écrite) ;
 * l'aperçu est composé directement dans la texture qui remplace le calque.
 *
 * Au relâchement seulement, les tuiles touchées sont relues : le raster
 * rendu au processeur reste la référence (invariant ④), et la texture
 * d'aperçu, qui le contient déjà, devient celle du nouvel actif.
 */

interface Programs {
  readonly deposit: WebGLProgram;
  readonly compose: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly framebuffer: WebGLFramebuffer;
  /** Les emplacements d'uniformes, cherchés une fois par programme. */
  readonly locations: Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>;
}

/** Les programmes de la brosse, ou `null` si la carte ne sait pas écrire de flottants. */
export const createBrushPrograms = (gl: WebGL2RenderingContext): Programs | null => {
  if (gl.getExtension('EXT_color_buffer_float') === null) return null;
  const vao = gl.createVertexArray();
  const framebuffer = gl.createFramebuffer();
  if (vao === null || framebuffer === null) return null;
  // Un rendu dans une texture R32F doit être complet, sinon : repli sur le processeur.
  const probe = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, probe);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, probe, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteTexture(probe);
  if (!complete) return null;
  return {
    deposit: createProgram(gl, BRUSH_VERTEX_SOURCE, DEPOSIT_FRAGMENT_SOURCE),
    compose: createProgram(gl, BRUSH_VERTEX_SOURCE, COMPOSE_FRAGMENT_SOURCE),
    vao,
    framebuffer,
    locations: new Map(),
  };
};

interface DensityTile {
  readonly rect: TileRect;
  readonly textures: [WebGLTexture, WebGLTexture];
  /** L'indice de la texture qui tient la densité à jour. */
  current: 0 | 1;
}

export class GpuPaintStroke implements PaintStroke {
  readonly #gl: WebGL2RenderingContext;
  readonly #programs: Programs;
  readonly #preview: StrokePreview;
  readonly #source: WebGLTexture | null;
  readonly #target: StrokeTarget;
  readonly #settings: BrushSettings;
  readonly #path: StrokePath;
  readonly #tip: { radius: number; hardness: number; antialias: number; spacing: number };
  readonly #tiles = new Map<number, DensityTile>();
  readonly #dirty = new Map<number, PixelRect>();

  constructor(
    gl: WebGL2RenderingContext,
    programs: Programs,
    preview: StrokePreview,
    source: WebGLTexture | null,
    target: StrokeTarget,
    settings: BrushSettings,
  ) {
    this.#gl = gl;
    this.#programs = programs;
    this.#preview = preview;
    this.#source = source;
    this.#target = target;
    this.#settings = settings;
    this.#path = new StrokePath(target, settings.diameter / 2);
    const tip = createTip(settings.diameter, settings.hardness, this.#path.pixelSize);
    this.#tip = { radius: tip.radius, hardness: tip.hardness, antialias: tip.antialias, spacing: tip.spacing };
  }

  /** Les tuiles que le trait a touchées. */
  get patchCount(): number {
    return this.#tiles.size;
  }

  append(point: Point): void {
    const update = this.#path.append(point);
    if (update !== null) this.#render(update);
  }

  present(): void {
    const preview = this.#preview.target;
    if (preview === null || this.#dirty.size === 0) return;
    const gl = this.#gl;
    const program = this.#programs.compose;
    this.#bind(program, preview);
    const tail = this.#path.tail[0];
    gl.uniform1i(this.#at(program, 'uHasTail'), tail === undefined ? 0 : 1);
    if (tail !== undefined) gl.uniform4f(this.#at(program, 'uTail'), ...tail);
    const { red, green, blue, opacity } = this.#settings;
    gl.uniform4f(this.#at(program, 'uColor'), red, green, blue, opacity);
    gl.uniform1i(this.#at(program, 'uHasSource'), this.#source === null ? 0 : 1);
    gl.uniform1i(this.#at(program, 'uPermanent'), 0);
    gl.uniform1i(this.#at(program, 'uSource'), 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#source);
    for (const [key, zone] of this.#dirty) {
      const tile = this.#tiles.get(key)!;
      gl.uniform2i(this.#at(program, 'uTileOrigin'), tile.rect.x, tile.rect.y);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tile.textures[tile.current]);
      gl.viewport(tile.rect.x + zone.x0, tile.rect.y + zone.y0, zone.x1 - zone.x0, zone.y1 - zone.y0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.#unbind();
    this.#dirty.clear();
    this.#preview.markStale();
  }

  finish(): RasterHandoff {
    const update = this.#path.flush();
    if (update !== null) this.#render(update);
    this.present();
    const preview = this.#preview.target;
    if (this.#tiles.size === 0 || preview === null) return { step: () => null, complete: () => null };
    const tiles = [...this.#tiles].map(([key, tile]) => [key, tile.rect] as const);
    return new TileReadback(this.#gl, this.#programs.framebuffer, preview.texture, tiles, this.#target);
  }

  adopt(asset: AssetId): void {
    this.#preview.commit(asset);
    this.#release();
  }

  cancel(): void {
    this.#preview.cancel();
    this.#release();
  }

  #render(update: PathUpdate): void {
    for (const [key, zone] of this.#path.zones(update)) {
      this.#allocate(key);
      this.#dirty.set(key, union(this.#dirty.get(key), zone));
    }
    if (update.settled.length > 0) this.#deposit(update.settled);
  }

  #allocate(key: number): void {
    if (this.#tiles.has(key)) return;
    const gl = this.#gl;
    const rect = tileRect(this.#target.width, this.#target.height, key);
    const make = (): WebGLTexture => {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // Une texture neuve vaut zéro partout : aucune densité encore.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, rect.width, rect.height, 0, gl.RED, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return texture;
    };
    this.#tiles.set(key, { rect, textures: [make(), make()], current: 0 });
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Dépose l'acquis dans chaque tuile qu'il atteint : lire une texture, écrire l'autre. */
  #deposit(settled: readonly Segment[]): void {
    const keys = new Set<number>();
    for (const segment of settled) {
      const reach = this.#path.reach(segment);
      if (reach !== null) for (const { key } of this.#path.tilesOf(reach)) keys.add(key);
    }
    if (keys.size === 0) return;
    const gl = this.#gl;
    const program = this.#programs.deposit;
    for (let start = 0; start < settled.length; start += MAX_SEGMENTS) {
      const chunk = settled.slice(start, start + MAX_SEGMENTS);
      this.#bind(program, null);
      gl.uniform4fv(this.#at(program, 'uSegments'), chunk.flat());
      gl.uniform1i(this.#at(program, 'uCount'), chunk.length);
      gl.uniform1i(this.#at(program, 'uPermanent'), 0);
      gl.activeTexture(gl.TEXTURE0);
      for (const key of keys) {
        const tile = this.#tiles.get(key)!;
        const next = (1 - tile.current) as 0 | 1;
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tile.textures[next], 0);
        gl.bindTexture(gl.TEXTURE_2D, tile.textures[tile.current]);
        gl.uniform2i(this.#at(program, 'uTileOrigin'), tile.rect.x, tile.rect.y);
        gl.viewport(0, 0, tile.rect.width, tile.rect.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        tile.current = next;
      }
      this.#unbind();
    }
  }

  /** Programme, uniformes communs, et cible : la texture d'aperçu, ou celle que l'appelant attachera. */
  #bind(program: WebGLProgram, preview: { texture: WebGLTexture } | null): void {
    const gl = this.#gl;
    gl.useProgram(program);
    gl.bindVertexArray(this.#programs.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#programs.framebuffer);
    if (preview !== null) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, preview.texture, 0);
    const m = this.#path.toDocument;
    gl.uniform4f(this.#at(program, 'uMapping'), m.a, m.b, m.c, m.d);
    gl.uniform2f(this.#at(program, 'uTranslation'), m.tx, m.ty);
    const { radius, hardness, antialias, spacing } = this.#tip;
    gl.uniform4f(this.#at(program, 'uTip'), radius, hardness, antialias, spacing);
    gl.uniform2f(this.#at(program, 'uCanvas'), this.#target.canvas.width, this.#target.canvas.height);
  }

  #at(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    let names = this.#programs.locations.get(program);
    if (names === undefined) {
      names = new Map();
      this.#programs.locations.set(program, names);
    }
    if (!names.has(name)) names.set(name, this.#gl.getUniformLocation(program, name));
    return names.get(name)!;
  }

  #unbind(): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  #release(): void {
    for (const tile of this.#tiles.values()) for (const texture of tile.textures) this.#gl.deleteTexture(texture);
    this.#tiles.clear();
    this.#dirty.clear();
  }
}
