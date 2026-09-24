import type { PixelBuffer } from '@compositor/model';

/**
 * Réduction d'un calque en vignette. Fonction pure : aucun DOM, testable en
 * Node.
 *
 * ## Pourquoi sur les octets prémultipliés
 *
 * La moyenne se fait **avant** de repasser en alpha droit. Moyenner des couleurs
 * droites mélangerait la couleur d'un pixel transparent — du noir, en pratique —
 * avec ses voisins opaques, et tout bord transparent se bordererait d'un liseré
 * sombre. En prémultiplié, un pixel transparent pèse zéro : il ne tire rien
 * vers le noir.
 *
 * ## Borné en coût
 *
 * Une image de 4096 px réduite à 72 px couvre des carrés de 57 × 57 pixels par
 * point de vignette. Chaque carré est échantillonné sur au plus 8 × 8 points,
 * ce qui borne le travail quelle que soit la taille de la source. Sur une
 * vignette de 36 px, la différence avec une moyenne exhaustive ne se voit pas.
 */

export interface Thumbnail {
  readonly width: number;
  readonly height: number;
  /** Alpha **droit**, prêt pour un `ImageData`. */
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

const SAMPLES_PER_AXIS = 8;

export const renderThumbnail = (buffer: PixelBuffer, size: number): Thumbnail => {
  const { width: w, height: h, data: src } = buffer;
  const scale = Math.min(size / w, size / h);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const out = new Uint8ClampedArray(tw * th * 4);

  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / th));
    const stepY = Math.max(1, Math.floor((y1 - y0) / SAMPLES_PER_AXIS));

    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / tw));
      const stepX = Math.max(1, Math.floor((x1 - x0) / SAMPLES_PER_AXIS));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const i = (y * w + x) * 4;
          r += src[i]!;
          g += src[i + 1]!;
          b += src[i + 2]!;
          a += src[i + 3]!;
          n++;
        }
      }

      const o = (ty * tw + tx) * 4;
      const alpha = a / n;
      out[o + 3] = Math.round(alpha);
      if (alpha <= 0) continue;
      // Retour en alpha droit, pour l'`ImageData` du canevas de vignette.
      const unpremultiply = 255 / alpha;
      out[o] = Math.round((r / n) * unpremultiply);
      out[o + 1] = Math.round((g / n) * unpremultiply);
      out[o + 2] = Math.round((b / n) * unpremultiply);
    }
  }

  return { width: tw, height: th, data: out };
};

/**
 * La forme du canevas, ajustée dans un carré de `box` points, en points
 * entiers — `CanvasThumbnail.fittedSize`. Une miniature montre le **canevas
 * entier**, comme Photoshop : un document en paysage donne une vignette en
 * paysage.
 *
 * Un canevas sans taille donne le carré plein, plutôt qu'une division par zéro.
 */
export const fittedSize = (
  canvasWidth: number,
  canvasHeight: number,
  box: number,
): { readonly width: number; readonly height: number } => {
  const valid =
    canvasWidth > 0 && canvasHeight > 0 && Number.isFinite(canvasWidth) && Number.isFinite(canvasHeight);
  if (!valid) return { width: box, height: box };
  const scale = box / Math.max(canvasWidth, canvasHeight);
  return {
    width: Math.max(1, Math.round(canvasWidth * scale)),
    height: Math.max(1, Math.round(canvasHeight * scale)),
  };
};
