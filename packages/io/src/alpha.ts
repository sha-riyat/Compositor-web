/**
 * Le contrat d'alpha, en un seul endroit.
 *
 * Entre l'import et le shader, **tout est prémultiplié** (invariant ②). Les
 * deux conversions vivent ici plutôt que recopiées dans l'import et dans
 * l'export : c'est par la duplication que ce genre de défaut revient.
 */

/**
 * Les pixels composés arrivent **prémultipliés** ; un PNG stocke de l'alpha
 * droit. Sans cette étape, tout pixel semi-transparent ressortirait assombri.
 */
export const unpremultiply = (
  pixels: Uint8ClampedArray<ArrayBuffer>,
): Uint8ClampedArray<ArrayBuffer> => {
  const out = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]!;
    out[i + 3] = alpha;
    if (alpha === 0) continue;
    if (alpha === 255) {
      out[i] = pixels[i]!;
      out[i + 1] = pixels[i + 1]!;
      out[i + 2] = pixels[i + 2]!;
      continue;
    }
    const scale = 255 / alpha;
    out[i] = Math.min(255, Math.round(pixels[i]! * scale));
    out[i + 1] = Math.min(255, Math.round(pixels[i + 1]! * scale));
    out[i + 2] = Math.min(255, Math.round(pixels[i + 2]! * scale));
  }
  return out;
};

/**
 * L'inverse : alpha droit → prémultiplié. C'est ce que fait l'import après
 * `getImageData`, qui rend toujours de l'alpha droit.
 *
 * **Le contrat à ne pas perdre de vue** : à partir d'ici et jusqu'au shader,
 * tout est prémultiplié. C'est pourquoi le téléversement des textures met
 * `UNPACK_PREMULTIPLY_ALPHA_WEBGL` à `false` — l'activer prémultiplierait une
 * seconde fois, et le défaut serait silencieux : l'opaque et le totalement
 * transparent resteraient justes, seuls les pixels intermédiaires
 * s'assombriraient.
 */
export const premultiply = (
  pixels: Uint8ClampedArray<ArrayBuffer>,
): Uint8ClampedArray<ArrayBuffer> => {
  const out = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]!;
    out[i + 3] = alpha;
    if (alpha === 255) {
      out[i] = pixels[i]!;
      out[i + 1] = pixels[i + 1]!;
      out[i + 2] = pixels[i + 2]!;
      continue;
    }
    if (alpha === 0) continue;
    const scale = alpha / 255;
    out[i] = Math.round(pixels[i]! * scale);
    out[i + 1] = Math.round(pixels[i + 1]! * scale);
    out[i + 2] = Math.round(pixels[i + 2]! * scale);
  }
  return out;
};
