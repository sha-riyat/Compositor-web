/**
 * Le contexte WebGL2 et la gestion de la densité d'écran.
 *
 * **Invariant ①** — on compose en sRGB **non linéaire**, comme Photoshop. Le
 * format interne est donc `RGBA8` et jamais `SRGB8_ALPHA8`, qui décoderait vers
 * le linéaire à l'échantillonnage. Voir le commentaire de
 * `reference/Compositor/Rendering/SeparableBlend.swift` : en linéaire, un gris
 * 80 % esquive vers 62 % au lieu de 100 %.
 *
 * **Invariant ②** — alpha prémultiplié partout.
 */

export interface RenderContext {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  /** Densité de l'écran au dernier redimensionnement. */
  dpr: number;
  /** Taille du tampon d'affichage, en pixels physiques. */
  pixelWidth: number;
  pixelHeight: number;
  /** Taille en pixels CSS. */
  cssWidth: number;
  cssHeight: number;
}

export const createRenderContext = (canvas: HTMLCanvasElement): RenderContext => {
  const gl = canvas.getContext('webgl2', {
    // Court-circuite la synchronisation habituelle du compositeur : c'est le
    // réglage prévu pour les applications de dessin, et le gain de latence est
    // le plus important de toute la liste.
    desynchronized: true,
    // Le canevas n'est pas composé avec la page : il la couvre entièrement.
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
  });

  if (gl === null) {
    throw new Error("WebGL2 indisponible : cet éditeur ne peut pas démarrer sans lui.");
  }

  // **false, et non true.** Ce drapeau demande à WebGL de prémultiplier la
  // source au téléversement — ce qu'il faut pour une source DOM (ImageBitmap,
  // <img>), qui arrive en alpha droit. Mais l'`AssetStore` tient déjà des
  // pixels prémultipliés (invariant ②), donc l'activer prémultiplierait une
  // seconde fois : un pixel bleu à 50 % ressort à la moitié de sa couleur, et
  // le défaut est silencieux — l'opaque et le totalement transparent, eux,
  // restent justes.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  // Sources prémultipliées : l'alpha n'est pas appliqué une seconde fois.
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  return {
    gl,
    canvas,
    dpr: 1,
    pixelWidth: 0,
    pixelHeight: 0,
    cssWidth: 0,
    cssHeight: 0,
  };
};

/**
 * Aligne le tampon d'affichage sur la taille CSS et la densité de l'écran.
 * Un canevas flou est jugé « bon marché » instantanément, et tout utilisateur
 * Mac est en densité double.
 */
export const resizeToDisplay = (context: RenderContext): boolean => {
  const { canvas, gl } = context;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
  const pixelHeight = Math.max(1, Math.round(rect.height * dpr));

  if (
    context.pixelWidth === pixelWidth &&
    context.pixelHeight === pixelHeight &&
    context.dpr === dpr
  ) {
    return false;
  }

  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  context.pixelWidth = pixelWidth;
  context.pixelHeight = pixelHeight;
  context.cssWidth = rect.width;
  context.cssHeight = rect.height;
  context.dpr = dpr;
  gl.viewport(0, 0, pixelWidth, pixelHeight);
  return true;
};

/**
 * `devicePixelRatio` change en cours de session quand on branche un écran
 * externe — un cas que personne ne teste, et qui laisse le canevas flou
 * jusqu'au prochain redimensionnement de fenêtre.
 *
 * Il n'existe pas d'événement dédié : on interroge une media query sur la
 * densité courante, et on en réarme une nouvelle à chaque changement.
 */
export const watchDevicePixelRatio = (onChange: () => void): (() => void) => {
  let query: MediaQueryList | null = null;
  let disposed = false;

  const arm = (): void => {
    if (disposed) return;
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', handle, { once: true });
  };

  const handle = (): void => {
    if (disposed) return;
    onChange();
    arm();
  };

  arm();

  return () => {
    disposed = true;
    query?.removeEventListener('change', handle);
    query = null;
  };
};

export const createShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('createShader a échoué');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'erreur inconnue';
    gl.deleteShader(shader);
    throw new Error(`Compilation du shader : ${log}`);
  }
  return shader;
};

export const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram => {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (program === null) throw new Error('createProgram a échoué');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'erreur inconnue';
    gl.deleteProgram(program);
    throw new Error(`Édition de liens : ${log}`);
  }
  return program;
};
