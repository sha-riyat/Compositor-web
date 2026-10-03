/**
 * Les shaders de la brosse — traduction en GLSL ES 3.0 du noyau Metal de
 * `MetalBrushCoverage.swift`. Deux passes par tuile :
 *
 * 1. **Dépôt** : la peinture acquise s'ajoute à la densité permanente de la
 *    tuile (pointe douce) ou en prend le maximum (pointe dure). La texture
 *    est en flottants ; on lit l'ancienne et on écrit la nouvelle (ping-pong),
 *    ce qui évite d'exiger le mélange de flottants (`EXT_float_blend`).
 * 2. **Composition** : la source du calque, puis la couleur à travers la
 *    couverture — fin provisoire comprise, jamais déposée —, quantifiée sur
 *    8 bits et à l'opacité du trait, écrites dans la texture d'aperçu.
 *
 * Les pixels se repèrent par `gl_FragCoord`, en pixels de la cible ; la
 * rangée 0 d'une texture est la rangée du haut du calque.
 */

export const MAX_SEGMENTS = 64;

/** Un rectangle qui couvre toute la zone de rendu, sans tampon de sommets. */
export const BRUSH_VERTEX_SOURCE = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  gl_Position = vec4(corner, 0.0, 1.0);
}
`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;

uniform vec4 uMapping;     // a, b, c, d : pixel du calque → document
uniform vec2 uTranslation; // tx, ty
uniform vec4 uTip;         // rayon, dureté, antialiasing, espacement des dépôts
uniform vec2 uCanvas;

vec2 documentPoint(vec2 pixel) {
  return uTranslation + pixel.x * uMapping.xy + pixel.y * uMapping.zw;
}

bool insideCanvas(vec2 p) {
  return p.x >= 0.0 && p.y >= 0.0 && p.x < uCanvas.x && p.y < uCanvas.y;
}

float segmentDistanceSquared(vec2 p, vec4 s) {
  vec2 v = s.zw - s.xy;
  float t = clamp(dot(p - s.xy, v) / max(dot(v, v), 1e-12), 0.0, 1.0);
  vec2 delta = p - (s.xy + t * v);
  return dot(delta, delta);
}

float brushCoverage(float distanceSquared) {
  float distance = sqrt(distanceSquared);
  float radius = uTip.x;
  if (uTip.y >= 1.0) return clamp((radius - distance) / uTip.z + 0.5, 0.0, 1.0);
  float t = clamp((distance / radius - uTip.y) / (1.0 - uTip.y), 0.0, 1.0);
  return max(0.0, (exp(-2.5 * t * t) - exp(-2.5)) / (1.0 - exp(-2.5)));
}

// La densité optique d'un dépôt ; elles s'additionnent, la couverture vaut 1 − exp(−densité).
float tipDensity(float distanceSquared) {
  return -log(max(1.0 - brushCoverage(distanceSquared), 0.001));
}

const float NODES[4] = float[4](0.1834346425, 0.5255324099, 0.7966664774, 0.9602898565);
const float WEIGHTS[4] = float[4](0.3626837834, 0.3137066459, 0.2223810345, 0.1012285363);

// Le dépôt intégré sur la distance parcourue : Gauss-Legendre à huit points,
// sur la seule portion du segment que la pointe atteint.
float segmentDensity(vec2 p, vec4 s) {
  vec2 v = s.zw - s.xy;
  float len = length(v);
  if (len < 1e-6) return tipDensity(dot(p - s.xy, p - s.xy));
  vec2 direction = v / len;
  float projection = dot(p - s.xy, direction);
  vec2 perpendicular = p - s.xy - projection * direction;
  float perpendicularSquared = dot(perpendicular, perpendicular);
  float radiusSquared = uTip.x * uTip.x;
  if (perpendicularSquared >= radiusSquared) return 0.0;
  float reach = sqrt(radiusSquared - perpendicularSquared);
  float lo = max(0.0, projection - reach);
  float hi = min(len, projection + reach);
  if (hi <= lo) return 0.0;
  float midpoint = (lo + hi) * 0.5;
  float halfLength = (hi - lo) * 0.5;
  float integral = 0.0;
  for (int i = 0; i < 4; i++) {
    float a = midpoint - halfLength * NODES[i] - projection;
    float b = midpoint + halfLength * NODES[i] - projection;
    integral += WEIGHTS[i] * (tipDensity(perpendicularSquared + a * a) + tipDensity(perpendicularSquared + b * b));
  }
  return integral * halfLength / uTip.w;
}
`;

export const DEPOSIT_FRAGMENT_SOURCE = `${COMMON}
uniform highp sampler2D uPermanent;
uniform ivec2 uTileOrigin;
uniform vec4 uSegments[${MAX_SEGMENTS}];
uniform int uCount;
out vec4 outValue;

void main() {
  ivec2 local = ivec2(gl_FragCoord.xy);
  float value = texelFetch(uPermanent, local, 0).r;
  vec2 p = documentPoint(vec2(uTileOrigin + local) + 0.5);
  if (insideCanvas(p)) {
    if (uTip.y >= 1.0) {
      float nearest = 1e30;
      for (int i = 0; i < uCount; i++) nearest = min(nearest, segmentDistanceSquared(p, uSegments[i]));
      value = max(value, brushCoverage(nearest));
    } else {
      for (int i = 0; i < uCount; i++) value += segmentDensity(p, uSegments[i]);
      value = min(value, 20.0);
    }
  }
  outValue = vec4(value, 0.0, 0.0, 1.0);
}
`;

export const COMPOSE_FRAGMENT_SOURCE = `${COMMON}
uniform highp sampler2D uPermanent;
uniform sampler2D uSource;
uniform bool uHasSource;
uniform ivec2 uTileOrigin;
uniform vec4 uTail;
uniform bool uHasTail;
uniform vec4 uColor; // rouge, vert, bleu, opacité du trait
out vec4 outColor;

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec2 p = documentPoint(vec2(pixel) + 0.5);
  bool soft = uTip.y < 1.0;
  float value = 0.0;
  if (insideCanvas(p)) {
    value = texelFetch(uPermanent, pixel - uTileOrigin, 0).r;
    if (uHasTail) {
      if (soft) value += segmentDensity(p, uTail);
      else value = max(value, brushCoverage(segmentDistanceSquared(p, uTail)));
    }
  }
  float coverage = soft ? 1.0 - exp(-min(value, 20.0)) : clamp(value, 0.0, 1.0);
  float alpha = floor(255.0 * coverage + 0.5) / 255.0 * uColor.a;
  vec4 source = uHasSource ? texelFetch(uSource, pixel, 0) : vec4(0.0);
  outColor = vec4(uColor.rgb * alpha, alpha) + source * (1.0 - alpha);
}
`;
