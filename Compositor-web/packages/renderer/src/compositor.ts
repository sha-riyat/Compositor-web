import type { AssetStore, BlendMode, CompositorDocument } from '@compositor/model';
import { effectiveOpacity, isEffectivelyVisible, layersById } from '@compositor/model';
import { createProgram, type RenderContext } from './context.js';
import { TextureCache } from './textures.js';
import { TransformOverlay } from './overlay.js';
import { RenderTarget } from './target.js';
import {
  BLEND_FRAGMENT_SOURCE,
  BLEND_VERTEX_SOURCE,
  blendModeIndex,
  needsBackdrop,
} from './blend.js';
import {
  mat3ForTransform,
  mat3Invert,
  mat3Multiply,
  mat3Projection,
  mat3Scale,
  mat3Translate,
  mat3View,
  type Mat3,
} from './mat3.js';

/**
 * Le compositeur.
 *
 * Les calques sont composés hors écran, de bas en haut. Un calque en Normal se
 * dessine directement avec la fonction de mélange fixe, sans passe
 * supplémentaire — c'est le cas de l'écrasante majorité d'entre eux.
 *
 * Un calque dans l'un des treize autres modes a besoin de lire le fond, ce que
 * WebGL2 interdit sur la cible qu'on écrit : il déclenche donc une passe pleine
 * cible vers la seconde cible, puis les deux s'échangent.
 *
 * Cette passe couvre tout le tampon plutôt que le quad du calque. Là où la
 * source est transparente, la formule de composition rend exactement le fond —
 * il n'y a donc rien à recopier avant, et le coût est d'une passe, pas de deux.
 *
 * Le même mécanisme accueillera les calques de réglage, qui lisent aussi le
 * fond.
 *
 * Ce qui n'est pas encore là : le pavage (T4) et les masques (T5).
 */

const VERTEX_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_unit;

uniform mat3 u_matrix;

out vec2 v_uv;

void main() {
  v_uv = a_unit;
  vec3 position = u_matrix * vec3(a_unit, 1.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_texture;
uniform float u_opacity;

out vec4 outColor;

void main() {
  // La texture est prémultipliée : l'opacité multiplie les quatre composantes.
  outColor = texture(u_texture, v_uv) * u_opacity;
}
`;

/** Le damier de transparence, sous les calques. */
const CHECKER_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;

uniform vec2 u_pixelSize;
uniform float u_cell;

out vec4 outColor;

void main() {
  vec2 cell = floor(v_uv * u_pixelSize / u_cell);
  float checker = mod(cell.x + cell.y, 2.0);
  outColor = vec4(mix(vec3(0.50), vec3(0.60), checker), 1.0);
}
`;

/** Le mode qu'un calque doit afficher, quand il diffère du sien. */
export interface BlendPreview {
  readonly layerId: string;
  readonly mode: BlendMode;
}

/** Matrice du quad plein cadre : le carré unité couvre l'espace de découpage. */
const FULL_TARGET = mat3Multiply(mat3Translate(-1, -1), mat3Scale(2, 2));

export class Compositor {
  #context: RenderContext;
  #textures: TextureCache;
  #overlay: TransformOverlay;
  #ping: RenderTarget;
  #pong: RenderTarget;

  #program: WebGLProgram;
  #checkerProgram: WebGLProgram;
  #blendProgram: WebGLProgram;
  #vao: WebGLVertexArrayObject;

  #uMatrix: WebGLUniformLocation | null;
  #uOpacity: WebGLUniformLocation | null;
  #uTexture: WebGLUniformLocation | null;
  #cMatrix: WebGLUniformLocation | null;
  #cPixelSize: WebGLUniformLocation | null;
  #cCell: WebGLUniformLocation | null;
  #bSource: WebGLUniformLocation | null;
  #bBackdrop: WebGLUniformLocation | null;
  #bOpacity: WebGLUniformLocation | null;
  #bMode: WebGLUniformLocation | null;
  #bInverse: WebGLUniformLocation | null;

  constructor(context: RenderContext, assets: AssetStore) {
    this.#context = context;
    this.#textures = new TextureCache(context.gl, assets);

    const gl = context.gl;
    this.#program = createProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
    this.#checkerProgram = createProgram(gl, VERTEX_SOURCE, CHECKER_FRAGMENT_SOURCE);
    this.#blendProgram = createProgram(gl, BLEND_VERTEX_SOURCE, BLEND_FRAGMENT_SOURCE);

    this.#uMatrix = gl.getUniformLocation(this.#program, 'u_matrix');
    this.#uOpacity = gl.getUniformLocation(this.#program, 'u_opacity');
    this.#uTexture = gl.getUniformLocation(this.#program, 'u_texture');
    this.#cMatrix = gl.getUniformLocation(this.#checkerProgram, 'u_matrix');
    this.#cPixelSize = gl.getUniformLocation(this.#checkerProgram, 'u_pixelSize');
    this.#cCell = gl.getUniformLocation(this.#checkerProgram, 'u_cell');
    this.#bSource = gl.getUniformLocation(this.#blendProgram, 'u_source');
    this.#bBackdrop = gl.getUniformLocation(this.#blendProgram, 'u_backdrop');
    this.#bOpacity = gl.getUniformLocation(this.#blendProgram, 'u_opacity');
    this.#bMode = gl.getUniformLocation(this.#blendProgram, 'u_mode');
    this.#bInverse = gl.getUniformLocation(this.#blendProgram, 'u_inverse');

    const vao = gl.createVertexArray();
    if (vao === null) throw new Error('createVertexArray a échoué');
    this.#vao = vao;
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.#overlay = new TransformOverlay(gl, vao, VERTEX_SOURCE);
    this.#ping = new RenderTarget(gl);
    this.#pong = new RenderTarget(gl);
  }

  get maxSide(): number {
    return this.#textures.maxSide;
  }

  render(
    document: CompositorDocument | null,
    viewport: { scale: number; offsetX: number; offsetY: number },
    overlay?: { activeLayerId: string | null; showsTransformBox: boolean },
    preview?: BlendPreview | null,
  ): void {
    const { gl, pixelWidth, pixelHeight, cssWidth, cssHeight, dpr } = this.#context;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clearColor(0.102, 0.102, 0.102, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Seules les textures du document affiché restent sur le GPU.
    this.#textures.retainOnly(
      new Set((document?.layers ?? []).flatMap((layer) => (layer.asset === null ? [] : [layer.asset]))),
    );

    if (document === null) return;

    const view = mat3Multiply(
      mat3Projection(cssWidth, cssHeight),
      mat3View(viewport.scale, viewport.offsetX, viewport.offsetY),
    );

    const composed = this.#compose(document, view, pixelWidth, pixelHeight, preview);

    // Le document est une fenêtre : ce qui déborde n'est pas visible, même si
    // les pixels du calque existent au-delà. L'export recadre de même.
    const left = Math.round(viewport.offsetX * dpr);
    const top = Math.round(viewport.offsetY * dpr);
    const boxWidth = Math.round(document.width * viewport.scale * dpr);
    const boxHeight = Math.round(document.height * viewport.scale * dpr);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.enable(gl.SCISSOR_TEST);
    // L'origine du ciseau est en bas à gauche, celle du document en haut.
    gl.scissor(left, pixelHeight - (top + boxHeight), boxWidth, boxHeight);

    this.#drawChecker(document, view, dpr, viewport.scale);
    this.#blit(composed);

    gl.disable(gl.SCISSOR_TEST);

    if (overlay?.showsTransformBox === true && overlay.activeLayerId !== null) {
      const layer = document.layers.find((l) => l.id === overlay.activeLayerId);
      if (layer !== undefined && !layer.isGroup) {
        this.#overlay.draw(layer.transform, view, viewport.scale);
      }
    }
  }

  /**
   * Compose la pile dans une cible hors écran et rend celle qui tient le
   * résultat — les deux cibles ayant pu s'échanger en chemin.
   */
  #compose(
    document: CompositorDocument,
    view: Mat3,
    width: number,
    height: number,
    preview?: BlendPreview | null,
  ): RenderTarget {
    const gl = this.#context.gl;
    let front = this.#ping;
    let back = this.#pong;

    front.resize(width, height);
    back.resize(width, height);
    front.assertComplete();
    front.clear();

    const byId = layersById(document);

    for (const layer of document.layers) {
      if (layer.isGroup || layer.asset === null) continue;
      if (!isEffectivelyVisible(layer, byId)) continue;

      const opacity = effectiveOpacity(layer, byId);
      if (opacity <= 0) continue;

      const entry = this.#textures.get(layer.asset);
      if (entry === undefined) continue;

      const matrix = mat3Multiply(view, mat3ForTransform(layer.transform));
      const nearest = layer.transform.sampling === 'nearest';
      // L'aperçu au survol remplace le mode à l'affichage, sans toucher au
      // calque : rien n'est écrit, rien n'est annulable.
      const mode =
        preview != null && preview.layerId === layer.id ? preview.mode : layer.blendMode;

      if (!needsBackdrop(mode)) {
        front.bind();
        gl.enable(gl.BLEND);
        gl.useProgram(this.#program);
        gl.bindVertexArray(this.#vao);
        gl.uniform1i(this.#uTexture, 0);
        gl.uniformMatrix3fv(this.#uMatrix, false, matrix);
        gl.uniform1f(this.#uOpacity, opacity);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        continue;
      }

      // Passe pleine cible : le résultat remplace le fond, sans mélange fixe.
      back.bind();
      gl.disable(gl.BLEND);
      gl.useProgram(this.#blendProgram);
      gl.bindVertexArray(this.#vao);
      gl.uniform1i(this.#bSource, 0);
      gl.uniform1i(this.#bBackdrop, 1);
      gl.uniform1f(this.#bOpacity, opacity);
      gl.uniform1i(this.#bMode, blendModeIndex(mode));
      gl.uniformMatrix3fv(this.#bInverse, false, mat3Invert(matrix));

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, front.texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0);

      [front, back] = [back, front];
    }

    gl.enable(gl.BLEND);
    gl.bindVertexArray(null);
    return front;
  }

  /** Reporte une cible hors écran sur la cible courante, en alpha prémultiplié. */
  #blit(target: RenderTarget): void {
    const gl = this.#context.gl;
    gl.enable(gl.BLEND);
    gl.useProgram(this.#program);
    gl.bindVertexArray(this.#vao);
    gl.uniform1i(this.#uTexture, 0);
    gl.uniformMatrix3fv(this.#uMatrix, false, FULL_TARGET);
    gl.uniform1f(this.#uOpacity, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  #drawChecker(
    document: CompositorDocument,
    view: Mat3,
    dpr: number,
    scale: number,
  ): void {
    const gl = this.#context.gl;
    gl.useProgram(this.#checkerProgram);
    gl.bindVertexArray(this.#vao);
    const matrix = mat3Multiply(
      view,
      mat3ForTransform({
        origin: { x: 0, y: 0 },
        size: { width: document.width, height: document.height },
        radians: 0,
        flipX: false,
        flipY: false,
        sampling: 'nearest',
      }),
    );
    gl.uniformMatrix3fv(this.#cMatrix, false, matrix);
    // La case est fixée à l'écran : le damier ne grossit pas au zoom.
    gl.uniform2f(this.#cPixelSize, document.width * scale * dpr, document.height * scale * dpr);
    gl.uniform1f(this.#cCell, 8 * dpr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /**
   * Compose hors écran à la taille du document et rend ses octets, en RGBA
   * prémultiplié, lignes de haut en bas.
   */
  composite(document: CompositorDocument): Uint8ClampedArray<ArrayBuffer> {
    const gl = this.#context.gl;
    const { width, height } = document;

    const target = this.#compose(document, mat3Projection(width, height), width, height);
    target.bind();

    const pixels = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixels.buffer));

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.#context.pixelWidth, this.#context.pixelHeight);

    // `readPixels` lit de bas en haut ; le document commence en haut.
    return flipRows(pixels, width, height);
  }

  dispose(): void {
    const gl = this.#context.gl;
    this.#textures.clear();
    this.#overlay.dispose();
    this.#ping.dispose();
    this.#pong.dispose();
    gl.deleteProgram(this.#program);
    gl.deleteProgram(this.#checkerProgram);
    gl.deleteProgram(this.#blendProgram);
    gl.deleteVertexArray(this.#vao);
  }
}

const flipRows = (
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> => {
  const stride = width * 4;
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * stride;
    out.set(pixels.subarray(from, from + stride), y * stride);
  }
  return out;
};
