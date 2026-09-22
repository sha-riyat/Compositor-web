import {
  ArrowsOutCardinal,
  Bandaids,
  Crop,
  Drop,
  Eyedropper,
  Hand,
  Lasso,
  MagicWand,
  MagnifyingGlass,
  PaintBrush,
  Rectangle,
  SelectionPlus,
  SquareHalfBottom,
  Stamp,
  TextT,
} from '@phosphor-icons/react';
import { ToggleButton, Toolbar } from 'react-aria-components';
import type { ToolId } from '@compositor/model';

/**
 * La barre d'outils.
 *
 * Trois points d'accessibilité, tous mesurés plutôt que supposés :
 *
 * 1. **`ToggleButton` et non `Button`.** Il pose `aria-pressed`, sans quoi
 *    l'outil actif n'existe pas pour un lecteur d'écran : la pastille bleue
 *    n'est qu'une couleur, et une couleur ne se lit pas.
 * 2. **L'icône de l'outil actif est blanche.** Elle était grise sur bleu, à
 *    1,35 : 1 — sous le seuil de 3 : 1 que WCAG 1.4.11 demande pour un
 *    composant d'interface. Les classes de couleur sont désormais exclusives :
 *    un seul `text-…` s'applique selon l'état, sans se contredire.
 * 3. **L'anneau de focus est décalé de 2 px**, pour qu'il tombe sur le fond du
 *    rail et reste visible même sur un bouton déjà bleu.
 *
 * Les outils pas encore disponibles restent affichés, dans une teinte plus
 * sourde — assez pour montrer ce que l'application deviendra, assez peu pour
 * qu'on ne les croie pas cliquables. Leur libellé le dit en clair, sans jargon
 * de planification.
 */

interface Entry {
  readonly id: ToolId;
  readonly label: string;
  readonly Icon: React.ComponentType<{ size?: number; weight?: 'regular' | 'bold' }>;
  readonly ready: boolean;
}

const TOOLS: readonly Entry[] = [
  { id: 'move', label: 'Déplacer / Transformer (V)', Icon: ArrowsOutCardinal, ready: true },
  { id: 'marquee', label: 'Rectangle de sélection (M)', Icon: SelectionPlus, ready: false },
  { id: 'lasso', label: 'Lasso (L)', Icon: Lasso, ready: false },
  { id: 'wand', label: 'Baguette magique (W)', Icon: MagicWand, ready: false },
  { id: 'crop', label: 'Recadrage (C)', Icon: Crop, ready: false },
  { id: 'brush', label: 'Brosse (B)', Icon: PaintBrush, ready: false },
  { id: 'spotHealing', label: 'Correcteur localisé (J)', Icon: Bandaids, ready: false },
  { id: 'cloneStamp', label: 'Tampon de duplication (S)', Icon: Stamp, ready: false },
  { id: 'blur', label: 'Flou (R)', Icon: Drop, ready: false },
  { id: 'gradient', label: 'Dégradé (G)', Icon: SquareHalfBottom, ready: false },
  { id: 'shape', label: 'Forme (U)', Icon: Rectangle, ready: false },
  { id: 'type', label: 'Texte (T)', Icon: TextT, ready: false },
  { id: 'eyedropper', label: 'Pipette (I)', Icon: Eyedropper, ready: false },
  { id: 'hand', label: 'Main (H)', Icon: Hand, ready: false },
  { id: 'zoom', label: 'Zoom (Z)', Icon: MagnifyingGlass, ready: false },
];

export interface ToolRailProps {
  readonly tool: ToolId;
  onToolChange(tool: ToolId): void;
}

export const ToolRail = ({ tool, onToolChange }: ToolRailProps): React.ReactElement => (
  <Toolbar
    orientation="vertical"
    aria-label="Outils"
    className="flex w-[36px] shrink-0 flex-col gap-0_5 border-r border-(--color-border) bg-(--color-panel) p-0_5"
  >
    {TOOLS.map(({ id, label, Icon, ready }) => {
      const isSelected = tool === id;
      return (
        <ToggleButton
          key={id}
          id={id}
          isSelected={isSelected}
          isDisabled={!ready}
          onChange={() => onToolChange(id)}
          aria-label={ready ? label : `${label} — pas encore disponible`}
          className={[
            'flex h-[28px] w-[28px] items-center justify-center rounded-sm',
            'transition-colors duration-100',
            // L'anneau tombe sur le fond du rail, jamais sur la pastille.
            'outline-offset-2',
            // Les trois états sont calculés ici plutôt que laissés à des
            // variantes conditionnelles : une seule classe de couleur
            // s'applique, et elle est vérifiable. Deux pièges rencontrés en
            // chemin — `opacity-45` n'existe pas dans l'échelle Tailwind, et la
            // variante `data-disabled:` ne produisait rien. Dans les deux cas
            // l'état indisponible s'affichait comme un état normal.
            !ready
              ? 'text-(--color-fg-faint)'
              : isSelected
                ? 'bg-(--color-accent) text-(--color-accent-fg)'
                : 'text-(--color-fg-muted) data-hovered:bg-(--color-panel-raised) data-hovered:text-(--color-fg)',
          ].join(' ')}
        >
          <Icon size={16} weight="regular" />
        </ToggleButton>
      );
    })}
  </Toolbar>
);
