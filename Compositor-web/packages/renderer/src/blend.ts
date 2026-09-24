import { BLEND_MODES, type BlendMode } from '@compositor/model';

/**
 * Les modes de fusion, écrits d'après les formules de la spécification PDF —
 * celles que Core Graphics implémente, et donc celles que l'application macOS
 * produit. Les dix que Core Graphics ne connaît pas (Densité linéaire, Lumière
 * vive, Soustraction…) passent côté macOS par Core Image ; leurs formules sont
 * celles de Photoshop, vérifiées par l'amont sur des valeurs chiffrées.
 *
 * ## Le terme que Core Graphics oublie
 *
 * La composition générale s'écrit, sur couleurs **dé-prémultipliées** :
 *
 *     αo = αs + αb·(1 − αs)
 *     Co = (1−αb)·αs·Cs  +  (1−αs)·αb·Cb  +  αs·αb·B(Cb, Cs)
 *
 * Le premier terme, `(1−αb)·αs·Cs`, est celui que Core Graphics laisse tomber
 * pour Color Dodge et Color Burn : une brosse douce y sort avec un bord dur.
 * `Compositor/Rendering/SeparableBlend.swift` contourne le défaut en
 * refaisant ces deux modes via Core Image, sur tout le canevas.
 *
 * En écrivant la formule complète, ce contournement n'existe pas — et le
 * résultat est plus juste que celui de l'original.
 *
 * ## L'espace de travail
 *
 * Tout se passe en **sRGB non linéaire** (invariant ①). Convertir en linéaire
 * avant de mélanger ferait diverger les valeurs de Photoshop : le commentaire
 * de `SeparableBlend.swift` chiffre l'écart.
 *
 * Le `Co` calculé par la formule est **déjà prémultiplié** : c'est une somme
 * pondérée par les alphas, donc rien n'est à remultiplier en sortie.
 */

/** L'indice passé en uniforme, aligné sur `BLEND_MODES` du modèle. */
export const blendModeIndex = (mode: BlendMode): number => BLEND_MODES.indexOf(mode);

/**
 * Les quatre modes non séparables, qui doivent fermer la liste : le shader les
 * reconnaît à `u_mode >= MODE_HUE`.
 */
const NON_SEPARABLE: readonly BlendMode[] = ['hue', 'saturation', 'color', 'luminosity'];
if (BLEND_MODES.slice(-NON_SEPARABLE.length).join() !== NON_SEPARABLE.join()) {
  throw new Error('Les modes non séparables doivent fermer BLEND_MODES.');
}

/**
 * Les indices des modes, **générés** depuis le modèle plutôt que recopiés :
 * l'ordre suit le menu de Photoshop, et un numéro écrit à la main dans le
 * GLSL divergerait en silence au prochain réordonnancement.
 */
const MODE_DEFINES = BLEND_MODES.map(
  (mode, index) => `#define MODE_${mode.toUpperCase()} ${index}`,
).join('\n');

/** Les modes qui exigent de lire le fond, donc une passe de ping-pong. */
export const needsBackdrop = (mode: BlendMode): boolean => mode !== 'normal';

export const BLEND_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

${MODE_DEFINES}

/** UV de la cible : cette passe couvre tout le tampon, pas le quad du calque. */
in vec2 v_uv;

uniform sampler2D u_source;
uniform sampler2D u_backdrop;
uniform float u_opacity;
uniform int u_mode;
/** UV de la cible vers UV du calque. */
uniform mat3 u_inverse;

out vec4 outColor;

const float EPS = 1e-5;

// ---------------------------------------------------------------- séparables

float blendMultiply(float b, float s)  { return b * s; }
float blendScreen(float b, float s)    { return b + s - b * s; }
float blendDarken(float b, float s)    { return min(b, s); }
float blendLighten(float b, float s)   { return max(b, s); }
float blendDifference(float b, float s){ return abs(b - s); }

float blendColorDodge(float b, float s) {
  if (b <= 0.0) return 0.0;
  if (s >= 1.0) return 1.0;
  return min(1.0, b / (1.0 - s));
}

float blendColorBurn(float b, float s) {
  if (b >= 1.0) return 1.0;
  if (s <= 0.0) return 0.0;
  return 1.0 - min(1.0, (1.0 - b) / s);
}

float blendHardLight(float b, float s) {
  return s <= 0.5 ? blendMultiply(b, 2.0 * s) : blendScreen(b, 2.0 * s - 1.0);
}

/** Incrustation, c'est Lumière crue avec les rôles échangés. */
float blendOverlay(float b, float s) { return blendHardLight(s, b); }

float blendSoftLight(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}

float blendLinearBurn(float b, float s)  { return max(0.0, b + s - 1.0); }
float blendLinearDodge(float b, float s) { return min(1.0, b + s); }
float blendLinearLight(float b, float s) { return clamp(b + 2.0 * s - 1.0, 0.0, 1.0); }
float blendExclusion(float b, float s)   { return b + s - 2.0 * b * s; }

/** Le fond moins la source, jamais l'inverse : l'amont s'y est déjà trompé. */
float blendSubtract(float b, float s)    { return max(0.0, b - s); }

/** Densité couleur + sous 50 %, Densité couleur − au-dessus. */
float blendVividLight(float b, float s) {
  return s <= 0.5 ? blendColorBurn(b, 2.0 * s) : blendColorDodge(b, 2.0 * s - 1.0);
}

float blendPinLight(float b, float s) {
  return s <= 0.5 ? min(b, 2.0 * s) : max(b, 2.0 * s - 1.0);
}

/**
 * Tout ou rien : 1 quand fond et source additionnés atteignent 1 — l'équivalent
 * exact de « Lumière vive ≥ 0,5 », sans ses divisions. Le demi-pas d'octet de
 * marge garde la décision stable malgré l'arrondi flottant.
 */
float blendHardMix(float b, float s) { return b + s > 1.0 - 0.5 / 255.0 ? 1.0 : 0.0; }

/** Diviser par zéro donne du blanc, sauf sur un fond noir : 0/0 reste noir. */
float blendDivide(float b, float s) {
  if (s <= 0.0) return b <= 0.0 ? 0.0 : 1.0;
  return min(1.0, b / s);
}

#define PER_CHANNEL(f) vec3(f(b.r, s.r), f(b.g, s.g), f(b.b, s.b))

vec3 separable(int mode, vec3 b, vec3 s) {
  switch (mode) {
    case MODE_DARKEN:      return PER_CHANNEL(blendDarken);
    case MODE_MULTIPLY:    return PER_CHANNEL(blendMultiply);
    case MODE_COLORBURN:   return PER_CHANNEL(blendColorBurn);
    case MODE_LINEARBURN:  return PER_CHANNEL(blendLinearBurn);
    case MODE_LIGHTEN:     return PER_CHANNEL(blendLighten);
    case MODE_SCREEN:      return PER_CHANNEL(blendScreen);
    case MODE_COLORDODGE:  return PER_CHANNEL(blendColorDodge);
    case MODE_LINEARDODGE: return PER_CHANNEL(blendLinearDodge);
    case MODE_OVERLAY:     return PER_CHANNEL(blendOverlay);
    case MODE_SOFTLIGHT:   return PER_CHANNEL(blendSoftLight);
    case MODE_HARDLIGHT:   return PER_CHANNEL(blendHardLight);
    case MODE_VIVIDLIGHT:  return PER_CHANNEL(blendVividLight);
    case MODE_LINEARLIGHT: return PER_CHANNEL(blendLinearLight);
    case MODE_PINLIGHT:    return PER_CHANNEL(blendPinLight);
    case MODE_HARDMIX:     return PER_CHANNEL(blendHardMix);
    case MODE_DIFFERENCE:  return PER_CHANNEL(blendDifference);
    case MODE_EXCLUSION:   return PER_CHANNEL(blendExclusion);
    case MODE_SUBTRACT:    return PER_CHANNEL(blendSubtract);
    case MODE_DIVIDE:      return PER_CHANNEL(blendDivide);
    default:               return s; // Normal
  }
}

// ------------------------------------------------------------ non séparables

/** Les coefficients de la spécification, et non ceux de Rec. 709. */
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }

/**
 * Ramène une couleur dans l'intervalle [0,1] en tirant vers sa luminosité,
 * plutôt qu'en écrêtant canal par canal — ce qui décalerait la teinte.
 */
vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(c.r, min(c.g, c.b));
  float x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + (c - l) * l / max(l - n, EPS);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, EPS);
  return c;
}

vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }

float sat(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }

/**
 * Le minimum tombe à zéro, le maximum monte à \`s\`, et le canal du milieu suit
 * la même proportion — la forme vectorielle de l'algorithme de la spec.
 */
vec3 setSat(vec3 c, float s) {
  float mn = min(c.r, min(c.g, c.b));
  float mx = max(c.r, max(c.g, c.b));
  return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0.0);
}

vec3 nonSeparable(int mode, vec3 b, vec3 s) {
  if (mode == MODE_HUE) return setLum(setSat(s, sat(b)), lum(b));
  if (mode == MODE_SATURATION) return setLum(setSat(b, sat(s)), lum(b));
  if (mode == MODE_COLOR) return setLum(s, lum(b));
  return setLum(b, lum(s)); // Luminosité
}

// --------------------------------------------------------------- composition

void main() {
  vec4 dst = texture(u_backdrop, v_uv);

  // Le calque ne couvre qu'une partie de la cible. Au-delà, la source est
  // transparente — et la formule rend alors exactement le fond, ce qui évite
  // d'avoir à recopier le fond avant la passe.
  vec3 local = u_inverse * vec3(v_uv * 2.0 - 1.0, 1.0);
  vec4 src = vec4(0.0);
  if (all(greaterThanEqual(local.xy, vec2(0.0))) && all(lessThanEqual(local.xy, vec2(1.0)))) {
    src = texture(u_source, local.xy) * u_opacity;
  }

  float as = src.a;
  float ab = dst.a;

  // Les formules travaillent sur des couleurs dé-prémultipliées.
  vec3 cs = as > EPS ? src.rgb / as : vec3(0.0);
  vec3 cb = ab > EPS ? dst.rgb / ab : vec3(0.0);

  vec3 blended = u_mode >= MODE_HUE ? nonSeparable(u_mode, cb, cs) : separable(u_mode, cb, cs);

  // Co est déjà prémultiplié : c'est une somme pondérée par les alphas.
  vec3 co = (1.0 - ab) * as * cs
          + (1.0 - as) * ab * cb
          + as * ab * blended;

  outColor = vec4(co, as + ab * (1.0 - as));
}
`;

/** Le quad plein cadre de la passe de fusion : pas de matrice, juste 0..1. */
export const BLEND_VERTEX_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_unit;

out vec2 v_uv;

void main() {
  v_uv = a_unit;
  gl_Position = vec4(a_unit * 2.0 - 1.0, 0.0, 1.0);
}
`;
