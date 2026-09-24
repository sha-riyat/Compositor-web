/**
 * La logique d'un champ numérique, sans React : lire ce qui est tapé, écrire
 * une valeur, avancer d'un pas. Reprise de `TransformValueField`
 * (`Compositor/UI/TransformInspector.swift`) et d'`ArrowStepper`
 * (`Compositor/ContentView.swift`).
 */

/**
 * Ce qui est tapé, lu comme un nombre — ou `null` si ce n'en est pas un.
 *
 * Strict comme `Double(text)` côté Swift : `12abc` n'est pas 12, et un champ
 * vide n'est pas 0. La virgule est acceptée en plus du point, parce qu'un
 * clavier français la produit sur le pavé numérique.
 */
export const parseNumber = (text: string): number | null => {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

/**
 * Pas de zéros inutiles sur un nombre entier, deux décimales sinon — la règle
 * de `TransformValueField.formatted`. Le point décimal, comme l'original.
 */
export const formatNumber = (value: number): string => {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 0.005) return String(rounded === 0 ? 0 : rounded);
  return value.toFixed(2);
};

export const clamp = (value: number, min?: number, max?: number): number => {
  let out = value;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
};

/**
 * La valeur après une flèche : un pas, ou dix avec Maj. Le pas part de la
 * valeur réelle, pas du texte en cours de frappe — comme `ArrowStepper`, qui
 * relit `value()` à chaque touche.
 */
export const stepNumber = (
  value: number,
  direction: 1 | -1,
  options: {
    readonly shift: boolean;
    readonly step?: number | undefined;
    readonly min?: number | undefined;
    readonly max?: number | undefined;
  },
): number => {
  const amount = (options.step ?? 1) * (options.shift ? 10 : 1);
  return clamp(value + direction * amount, options.min, options.max);
};
