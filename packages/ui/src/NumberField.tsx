import { useEffect, useState } from 'react';

/**
 * Un champ numérique d'en-tête d'outil.
 *
 * Il valide à la sortie du champ et à Entrée, abandonne à Échap, et avance aux
 * flèches — Maj pour aller par dix. C'est le minimum utilisable.
 *
 * **Ce n'est pas encore le composant définitif.** Il manque le scrub sur le
 * libellé, le réglage fin à Alt et la saisie d'expression. Celui-là servira
 * aussi aux Courbes, aux Niveaux et à la taille de brosse : il mérite d'être
 * écrit une fois pour toutes, pas ici à la hâte.
 */

export interface NumberFieldProps {
  readonly label: string;
  readonly value: number;
  readonly disabled?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
  onChange(next: number): void;
}

export const NumberField = ({
  label,
  value,
  disabled = false,
  min,
  max,
  unit,
  onChange,
}: NumberFieldProps): React.ReactElement => {
  const [draft, setDraft] = useState(format(value));
  const [editing, setEditing] = useState(false);

  // Tant que le champ n'est pas en cours d'édition, il suit la valeur réelle —
  // qui bouge aussi quand on fait glisser le calque sur le canevas.
  useEffect(() => {
    if (!editing) setDraft(format(value));
  }, [value, editing]);

  const commit = (text: string): void => {
    const parsed = Number.parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      setDraft(format(value));
      return;
    }
    onChange(clamp(parsed, min, max));
  };

  const step = (delta: number): void => {
    onChange(clamp(value + delta, min, max));
  };

  return (
    <label className="flex shrink-0 items-center gap-1">
      <span className="text-(--color-fg-muted)">{label}</span>
      <input
        value={draft}
        disabled={disabled}
        inputMode="decimal"
        onChange={(event) => {
          setEditing(true);
          setDraft(event.target.value);
        }}
        onBlur={() => {
          setEditing(false);
          commit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            setEditing(false);
            commit(draft);
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setEditing(false);
            setDraft(format(value));
            event.currentTarget.blur();
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? 1 : -1;
            step(direction * (event.shiftKey ? 10 : 1));
          }
          event.stopPropagation();
        }}
        className="numeric h-control w-[54px] rounded-sm border border-(--color-border) bg-(--color-panel-sunken) px-1 text-right text-ui text-(--color-fg) outline-none focus:border-(--color-accent) disabled:opacity-40"
      />
      {unit !== undefined && <span className="text-(--color-fg-muted)">{unit}</span>}
    </label>
  );
};

/** Entier quand c'en est un, une décimale sinon — comme l'original. */
const format = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const clamp = (value: number, min?: number, max?: number): number => {
  let out = value;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
};
