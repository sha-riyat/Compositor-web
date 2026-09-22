import type { AssetStore, CompositorDocument, Layer } from '@compositor/model';
import { effectiveOpacity, isEffectivelyVisible, layersById } from '@compositor/model';
import { createProgram, type RenderContext } from './context.js';
import { TextureCache } from './textures.js';
import { TransformOverlay } from './overlay.js';
import {
  mat3ForTransform,
  mat3Multiply,
  mat3Projection,
  mat3View,
  type Mat3,
} from './mat3.js';

/**
 * Le compositeur de T1 : volontairement naïf.
 *
 * Une texture par calque, rendues de bas en haut en mode Normal avec
 * `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`. **Pas de pavage, pas de modes de
 * fusion, pas de masques** — ce sont des no-gos explicites du pari, qui
 * arrivent en T4, T2 et T5.
 *
 * Ce qu'il doit prouver, et rien de plus : que le chemin
 * document → texture → écran fonctionne avec le bon espace colorimétrique et la
 * bonne prémultiplication.
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
  // La texture est prémultipliée : l'opacité multiplie les quatre composantes,
  // elle ne s'applique pas au seul alpha.
  outColor = texture(u_texture, v_uv) * u_opacity;
}
`;

/** Le damier de transparence, dessiné sous les calques. */
const CHECKER_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;

uniform vec2 u_pixelSize;
uniform float u_cell;

out vec4 outColor;

void main() {
  vec2 pixel = v_uv * u_pixelSize;
  vec2 cell = floor(pixel / u_cell);
  float checker = mod(cell.x + cell.y, 2.0);
  vec3 light = vec3(0.60);
  vec3 dark = vec3(0.50);
  outColor = vec4(mix(dark, light, checker), 1.0);
}
`;

export class Compositor {
  #context: RenderContext;
  #textures: TextureCache;
  #program: WebGLProgram;
  #checkerProgram: WebGLProgram;
  #overlay: TransformOverlay;
  #vao: WebGLVertexArrayObject;
  #uMatrix: WebGLUniformLocation | null;
  #uOpacity: WebGLUniformLocation | null;
  #uTexture: WebGLUniformLocation | null;
  #cMatrix: WebGLUniformLocation | null;
  #cPixelSize: WebGLUniformLocation | null;
  #cCell: WebGLUniformLocation | null;

  constructor(context: RenderContext, assets: AssetStore) {
    this.#context = context;
    this.#textures = new TextureCache(context.gl, assets);

    const gl = context.gl;
    this.#program = createProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
    this.#checkerProgram = createProgram(gl, VERTEX_SOURCE, CHECKER_FRAGMENT_SOURCE);

    this.#uMatrix = gl.getUniformLocation(this.#program, 'u_matrix');
    this.#uOpacity = gl.getUniformLocation(this.#program, 'u_opacity');
    this.#uTexture = gl.getUniformLocation(this.#program, 'u_texture');
    this.#cMatrix = gl.getUniformLocation(this.#checkerProgram, 'u_matrix');
    this.#cPixelSize = gl.getUniformLocation(this.#checkerProgram, 'u_pixelSize');
    this.#cCell = gl.getUniformLocation(this.#checkerProgram, 'u_cell');

    const vao = gl.createVertexArray();
    if (vao === null) throw new Error('createVertexArray a échoué');
    this.#vao = vao;
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.#overlay = new TransformOverlay(gl, this.#vao, VERTEX_SOURCE);
  }

  get maxSide(): number {
    return this.#textures.maxSide;
  }

  /** Rend le document dans le canevas, au zoom et au décalage donnés. */
  render(
    document: CompositorDocument | null,
    viewport: { scale: number; offsetX: number; offsetY: number },
    overlay?: { activeLayerId: string | null; showsTransformBox: boolean },
  ): void {
    const { gl, pixelWidth, pixelHeight, cssWidth, cssHeight, dpr } = this.#context;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clearColor(0.102, 0.102, 0.102, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (document === null) return;

    const projection = mat3Projection(cssWidth, cssHeight);
    const view = mat3Multiply(projection, mat3View(viewport.scale, viewport.offsetX, viewport.offsetY));

    // Le document est une fenêtre : ce qui déborde n'est pas visible, même si
    // les pixels du calque existent toujours au-delà. L'export recadre de la
    // même façon, en composant à la taille du document.
    const left = Math.round(viewport.offsetX * dpr);
    const top = Math.round(viewport.offsetY * dpr);
    const boxWidth = Math.round(document.width * viewport.scale * dpr);
    const boxHeight = Math.round(document.height * viewport.scale * dpr);
    gl.enable(gl.SCISSOR_TEST);
    // L'origine du ciseau est en bas à gauche, celle du document en haut à gauche.
    gl.scissor(left, pixelHeight - (top + boxHeight), boxWidth, boxHeight);

    this.#drawChecker(document, view, dpr, viewport.scale);
    this.#drawLayers(document, view);

    gl.disable(gl.SCISSOR_TEST);

    if (overlay?.showsTransformBox === true && overlay.activeLayerId !== null) {
      const layer = document.layers.find((l) => l.id === overlay.activeLayerId);
      if (layer !== undefined && !layer.isGroup) {
        this.#overlay.draw(layer.transform, view, viewport.scale);
      }
    }
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
    // La taille de la case est fixée à l'écran, pas au document : le damier ne
    // grossit pas quand on zoome.
    gl.uniform2f(this.#cPixelSize, document.width * scale * dpr, document.height * scale * dpr);
    gl.uniform1f(this.#cCell, 8 * dpr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  #drawLayers(document: CompositorDocument, view: Mat3): void {
    const gl = this.#context.gl;
    const byId = layersById(document);

    gl.useProgram(this.#program);
    gl.bindVertexArray(this.#vao);
    gl.uniform1i(this.#uTexture, 0);
    gl.activeTexture(gl.TEXTURE0);

    for (const layer of document.layers) {
      this.#drawLayer(layer, byId, view);
    }

    gl.bindVertexArray(null);
  }

  #drawLayer(layer: Layer, byId: ReadonlyMap<string, Layer>, view: Mat3): void {
    if (layer.isGroup || layer.asset === null) return;
    if (!isEffectivelyVisible(layer, byId)) return;

    const opacity = effectiveOpacity(layer, byId);
    if (opacity <= 0) return;

    const entry = this.#textures.get(layer.asset);
    if (entry === undefined) return;

    const gl = this.#context.gl;
    const matrix = mat3Multiply(view, mat3ForTransform(layer.transform));
    gl.uniformMatrix3fv(this.#uMatrix, false, matrix);
    gl.uniform1f(this.#uOpacity, opacity);
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MAG_FILTER,
      layer.transform.sampling === 'nearest' ? gl.NEAREST : gl.LINEAR,
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Compose le document hors écran et rend ses octets, en RGBA prémultiplié,
   * lignes de haut en bas.
   *
   * C'est par ici que passe le critère de sortie du pari : un PNG importé puis
   * exporté sans rien toucher doit revenir identique. Si ce n'est pas le cas,
   * c'est qu'un espace colorimétrique ou une prémultiplication est fausse — et
   * il vaut mieux le savoir en T1 qu'en T7.
   */
  composite(document: CompositorDocument): Uint8ClampedArray<ArrayBuffer> {
    const gl = this.#context.gl;
    const { width, height } = document;

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (texture === null || framebuffer === null) {
      throw new Error("Impossible d'allouer la cible de composition");
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(`Cible de composition incomplète (0x${status.toString(16)})`);
    }

    gl.viewport(0, 0, width, height);
    // Fond transparent : l'export conserve l'alpha du document.
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Projection directe sur le document, sans zoom ni décalage.
    this.#drawLayers(document, mat3Projection(width, height));

    const pixels = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(
      0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array(pixels.buffer),
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    gl.viewport(0, 0, this.#context.pixelWidth, this.#context.pixelHeight);

    // `readPixels` lit de bas en haut : on remet les lignes dans l'ordre du
    // document, qui commence en haut.
    return flipRows(pixels, width, height);
  }

  dispose(): void {
    const gl = this.#context.gl;
    this.#textures.clear();
    gl.deleteProgram(this.#program);
    gl.deleteProgram(this.#checkerProgram);
    this.#overlay.dispose();
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
