import type { Transform } from '@compositor/model';
import { createProgram } from './context.js';
import { mat3ForTransform, mat3Multiply, type Mat3 } from './mat3.js';

/** Aplat uni, pour la boîte de transformation et ses poignées. */
const SOLID_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

uniform vec4 u_color;

out vec4 outColor;

void main() {
  outColor = u_color;
}
`;

/**
 * La boîte de transformation et ses huit poignées.
 *
 * Elle est dessinée **hors du recadrage sur le document** : une poignée reste
 * saisissable même quand le calque déborde du canevas.
 *
 * Les épaisseurs sont fixées à l'écran et divisées par le zoom, pour que la
 * boîte garde la même finesse quel que soit l'agrandissement.
 */
export class TransformOverlay {
  #gl: WebGL2RenderingContext;
  #vao: WebGLVertexArrayObject;
  #program: WebGLProgram;
  #uMatrix: WebGLUniformLocation | null;
  #uColor: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject, vertexSource: string) {
    this.#gl = gl;
    this.#vao = vao;
    this.#program = createProgram(gl, vertexSource, SOLID_FRAGMENT_SOURCE);
    this.#uMatrix = gl.getUniformLocation(this.#program, 'u_matrix');
    this.#uColor = gl.getUniformLocation(this.#program, 'u_color');
  }

  draw(transform: Transform, view: Mat3, scale: number): void {
    const gl = this.#gl;
    gl.useProgram(this.#program);
    gl.bindVertexArray(this.#vao);

    const { origin, size } = transform;
    const line = 1 / scale;
    const accent = [0.176, 0.498, 0.976, 1] as const;

    this.#quad(view, origin.x, origin.y, size.width, line, accent);
    this.#quad(view, origin.x, origin.y + size.height - line, size.width, line, accent);
    this.#quad(view, origin.x, origin.y, line, size.height, accent);
    this.#quad(view, origin.x + size.width - line, origin.y, line, size.height, accent);

    const handle = 7 / scale;
    const half = handle / 2;
    const border = 1 / scale;
    for (const [hx, hy] of handlePositions(transform)) {
      this.#quad(view, hx - half, hy - half, handle, handle, accent);
      this.#quad(
        view,
        hx - half + border, hy - half + border,
        handle - border * 2, handle - border * 2,
        [1, 1, 1, 1],
      );
    }

    gl.bindVertexArray(null);
  }

  #quad(
    view: Mat3,
    x: number, y: number, w: number, h: number,
    color: readonly number[],
  ): void {
    const gl = this.#gl;
    const matrix = mat3Multiply(
      view,
      mat3ForTransform({
        origin: { x, y },
        size: { width: w, height: h },
        radians: 0,
        flipX: false,
        flipY: false,
        sampling: 'nearest',
      }),
    );
    gl.uniformMatrix3fv(this.#uMatrix, false, matrix);
    gl.uniform4f(this.#uColor, color[0]!, color[1]!, color[2]!, color[3]!);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    this.#gl.deleteProgram(this.#program);
  }
}

/** Les huit poignées, dans le même ordre que `handlePosition` côté outil. */
const handlePositions = (
  transform: Transform,
): readonly (readonly [number, number])[] => {
  const { origin, size } = transform;
  return [
    [origin.x, origin.y],
    [origin.x + size.width / 2, origin.y],
    [origin.x + size.width, origin.y],
    [origin.x, origin.y + size.height / 2],
    [origin.x + size.width, origin.y + size.height / 2],
    [origin.x, origin.y + size.height],
    [origin.x + size.width / 2, origin.y + size.height],
    [origin.x + size.width, origin.y + size.height],
  ];
};
