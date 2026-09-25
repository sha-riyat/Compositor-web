import { useEffect, useRef, useState } from 'react';
import { clamp, formatNumber, parseNumber, stepNumber } from './numericValue.js';

/**
 * Le champ numérique de l'éditeur, repris de `TransformValueField`
 * (`Compositor/UI/TransformInspector.swift`) et du champ de pourcentage de
 * `LayerAppearanceControls.swift`.
 *
 * - **Flèches** : un pas, dix avec Maj, depuis la valeur réelle (`ArrowStepper`).
 * - **Entrée et Échap** rendent la main au canevas, pour que la touche d'un
 *   outil marche aussitôt. Échap n'annule pas : dans l'original, il libère le
 *   champ, ce qui applique la valeur (`onExitCommand { releaseFocus() }`).
 * - Tant qu'il a le focus, le champ **ne se resynchronise pas** : il ne se bat
 *   pas avec ce qu'on tape. Une flèche, elle, réécrit le nombre appliqué.
 *
 * Deux façons d'appliquer, comme dans l'original :
 * - `applyWhileTyping` — chaque frappe qui forme un nombre s'applique tout de
 *   suite (X, Y, L, H) ;
 * - sinon, la valeur s'applique en quittant le champ (pourcentage d'opacité).
 *
 * Ce que l'original n'a pas, ce champ ne l'a pas non plus : ni glissement sur
 * le libellé, ni saisie d'expression.
 */
export interface NumberFieldProps {
  readonly label: string;
  readonly value: number;
  onChange(next: number): void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Affiché après le champ, hors de la valeur : `%`, `°`. */
  readonly unit?: string;
  readonly disabled?: boolean;
  readonly applyWhileTyping?: boolean;
  /** Le libellé n'est alors lu que par les technologies d'assistance. */
  readonly hideLabel?: boolean;
  /** Une classe de largeur Tailwind écrite en toutes lettres, `w-[44px]`. */
  readonly widthClass?: string;
  /**
   * Le séjour dans le champ, du focus à la sortie : ce que la frappe y change
   * ne fait alors qu'**une** entrée d'annulation.
   */
  onEditStart?(): void;
  onEditEnd?(): void;
}

export const NumberField = ({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  disabled = false,
  applyWhileTyping = false,
  hideLabel = false,
  widthClass = 'w-[54px]',
  onEditStart,
  onEditEnd,
}: NumberFieldProps): React.ReactElement => {
  const [draft, setDraft] = useState(formatNumber(value));
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Une référence plutôt qu'un état : la fin d'édition doit partir une seule
  // fois, même si le champ disparaît pendant qu'il a le focus.
  const editing = useRef(false);
  const endEditing = useRef(onEditEnd);
  endEditing.current = onEditEnd;

  useEffect(
    () => () => {
      if (editing.current) endEditing.current?.();
    },
    [],
  );

  // Hors édition, le champ suit la valeur réelle — qui bouge aussi quand on
  // fait glisser le calque sur le canevas.
  useEffect(() => {
    if (!focused) setDraft(formatNumber(value));
  }, [value, focused]);

  const apply = (next: number): void => {
    const bounded = clamp(next, min, max);
    if (bounded !== value) onChange(bounded);
  };

  /** Quitter le champ applique ce qui a été tapé, ou rétablit la valeur. */
  const release = (): void => {
    const parsed = parseNumber(draft);
    if (parsed !== null) apply(parsed);
    setFocused(false);
    if (editing.current) {
      editing.current = false;
      onEditEnd?.();
    }
  };

  return (
    <label className="flex shrink-0 items-center gap-1">
      <span className={hideLabel ? 'sr-only' : 'text-(--color-fg-muted)'}>{label}</span>
      <input
        ref={input}
        value={draft}
        disabled={disabled}
        inputMode="decimal"
        onFocus={() => {
          setFocused(true);
          if (!editing.current) {
            editing.current = true;
            onEditStart?.();
          }
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          if (applyWhileTyping) {
            const parsed = parseNumber(event.target.value);
            if (parsed !== null) apply(parsed);
          }
        }}
        onBlur={release}
        onKeyDown={(event) => {
          // Les raccourcis globaux — chiffres pour l'opacité, Maj +/− pour le
          // mode — ne doivent pas voir ce qui se tape ici.
          event.stopPropagation();
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            input.current?.blur();
            return;
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const next = stepNumber(value, event.key === 'ArrowUp' ? 1 : -1, {
              shift: event.shiftKey,
              step,
              min,
              max,
            });
            apply(next);
            setDraft(formatNumber(next));
          }
        }}
        className={[
          'numeric h-control rounded-sm border border-(--color-border) bg-(--color-panel-sunken) px-1',
          'text-right text-ui text-(--color-fg) outline-none focus:border-(--color-accent) disabled:opacity-40',
          widthClass,
        ].join(' ')}
      />
      {unit !== undefined && <span className="text-(--color-fg-muted)">{unit}</span>}
    </label>
  );
};
