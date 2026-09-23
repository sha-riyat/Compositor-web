import { BLEND_MODES, type BlendMode } from '@compositor/model';

/**
 * Les quatorze modes de fusion, écrits d'après les formules de la spécification
 * PDF — celles que Core Graphics implémente, et donc celles que l'application
 * macOS produit.
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

/** Les modes qui exigent de lire le fond, donc une passe de ping-pong. */
export const needsBackdrop = (mode: BlendMode): boolean => mode !== 'normal';

export const BLEND_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

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

vec3 separable(int mode, vec3 b, vec3 s) {
  if (mode == 1) return vec3(blendMultiply(b.r, s.r), blendMultiply(b.g, s.g), blendMultiply(b.b, s.b));
  if (mode == 2) return vec3(blendScreen(b.r, s.r), blendScreen(b.g, s.g), blendScreen(b.b, s.b));
  if (mode == 3) return vec3(blendOverlay(b.r, s.r), blendOverlay(b.g, s.g), blendOverlay(b.b, s.b));
  if (mode == 4) return vec3(blendSoftLight(b.r, s.r), blendSoftLight(b.g, s.g), blendSoftLight(b.b, s.b));
  if (mode == 5) return vec3(blendDarken(b.r, s.r), blendDarken(b.g, s.g), blendDarken(b.b, s.b));
  if (mode == 6) return vec3(blendLighten(b.r, s.r), blendLighten(b.g, s.g), blendLighten(b.b, s.b));
  if (mode == 7) return vec3(blendDifference(b.r, s.r), blendDifference(b.g, s.g), blendDifference(b.b, s.b));
  if (mode == 8) return vec3(blendColorDodge(b.r, s.r), blendColorDodge(b.g, s.g), blendColorDodge(b.b, s.b));
  if (mode == 9) return vec3(blendColorBurn(b.r, s.r), blendColorBurn(b.g, s.g), blendColorBurn(b.b, s.b));
  return s; // Normal
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
  if (mode == 10) return setLum(setSat(s, sat(b)), lum(b)); // Teinte
  if (mode == 11) return setLum(setSat(b, sat(s)), lum(b)); // Saturation
  if (mode == 12) return setLum(s, lum(b));                 // Couleur
  return setLum(b, lum(s));                                 // Luminosité
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

  vec3 blended = u_mode >= 10 ? nonSeparable(u_mode, cb, cs) : separable(u_mode, cb, cs);

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
