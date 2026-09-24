import { useEffect, useRef, useState } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import type { Layer } from '@compositor/model';
import { LayerThumbnail } from './LayerThumbnail.js';

/**
 * Une ligne du panneau de calques — 52 px de haut, comme
 * `NativeLayerList.swift`.
 *
 * La sélection se fait au `pointerdown`, pas au clic : ce délai n'existe pas
 * dans le DOM, mais c'est ce qui donne la sensation d'un outil plutôt que
 * d'une page.
 */

export interface LayerRowProps {
  readonly layer: Layer;
  /** Seconde ligne, en gris : dimensions, « Dossier », « Écrêté sur … ». */
  readonly subtitle: string;
  readonly isSelected: boolean;
  readonly isActive: boolean;
  /** Actif et seul sélectionné : sa miniature porte la bordure d'accent. */
  readonly isSoleSelection: boolean;
  readonly isRenaming: boolean;
  readonly isDragging: boolean;
  onSelect(event: React.PointerEvent): void;
  onToggleVisible(): void;
  onStartRename(): void;
  onCommitRename(name: string | null): void;
  onDragStart(event: React.PointerEvent): void;
}

export const LayerRow = ({
  layer,
  subtitle,
  isSelected,
  isActive,
  isSoleSelection,
  isRenaming,
  isDragging,
  onSelect,
  onToggleVisible,
  onStartRename,
  onCommitRename,
  onDragStart,
}: LayerRowProps): React.ReactElement => {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(layer.name);

  useEffect(() => {
    if (!isRenaming) return;
    setDraft(layer.name);
    // Le champ prend le focus et sélectionne tout, comme un renommage en place.
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  }, [isRenaming, layer.name]);

  return (
    <div
      role="option"
      aria-selected={isSelected}
      aria-current={isActive ? 'true' : undefined}
      className={[
        'flex h-layer-row items-center gap-2 rounded-sm px-2 text-ui',
        'cursor-default select-none',
        isSelected
          ? 'bg-(--color-selection) text-(--color-accent-fg)'
          : 'hover:bg-(--color-panel-raised)',
        isDragging ? 'opacity-40' : '',
        layer.isVisible ? '' : 'opacity-60',
      ].join(' ')}
      onPointerDown={(event) => {
        if (isRenaming) return;
        onSelect(event);
        onDragStart(event);
      }}
      onDoubleClick={onStartRename}
    >
      <button
        type="button"
        aria-label={layer.isVisible ? `Masquer ${layer.name}` : `Afficher ${layer.name}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onToggleVisible}
        className="flex h-control w-control shrink-0 items-center justify-center rounded-sm opacity-70 hover:opacity-100"
      >
        {layer.isVisible ? <Eye size={14} /> : <EyeSlash size={14} />}
      </button>

      <LayerThumbnail layer={layer} highlighted={isActive && isSoleSelection} />

      {isRenaming ? (
        <input
          ref={input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onBlur={() => onCommitRename(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCommitRename(draft);
            // Échap abandonne : le nom d'origine reste.
            if (event.key === 'Escape') onCommitRename(null);
            event.stopPropagation();
          }}
          className="min-w-0 flex-1 rounded-sm border border-(--color-accent) bg-(--color-panel-sunken) px-1 text-ui text-(--color-fg) outline-none"
        />
      ) : (
        <span className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="truncate">{layer.name}</span>
          <span
            className={[
              'numeric truncate text-[10px] leading-[13px]',
              // Blanc plein, et non blanc atténué : une opacité de 75 % ferait
              // retomber le sous-titre à 2,8 : 1. Il se distingue par sa
              // taille, pas par son opacité.
              isSelected ? 'text-(--color-accent-fg)' : 'text-(--color-fg-faint)',
            ].join(' ')}
          >
            {subtitle}
          </span>
        </span>
      )}
    </div>
  );
};
