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
import { Button, Toolbar } from 'react-aria-components';
import type { ToolId } from '@compositor/model';

/**
 * La barre d'outils. Phosphor brut en T1 : la graisse des icônes et les quinze
 * dessins maison sont calibrés en T4, quand cette barre devient ce qu'on
 * regarde en permanence.
 *
 * Les icônes sont affichées à 16 px et Phosphor est dessiné sur une grille de
 * 256 : le rapport est entier, donc les traits restent nets.
 */

interface Entry {
  readonly id: ToolId;
  readonly label: string;
  readonly Icon: React.ComponentType<{ size?: number; weight?: 'regular' | 'bold' }>;
  readonly ready: boolean;
  readonly slice?: string;
}

const TOOLS: readonly Entry[] = [
  { id: 'move', label: 'Déplacer / Transformer (V)', Icon: ArrowsOutCardinal, ready: true },
  { id: 'marquee', label: 'Rectangle de sélection (M)', Icon: SelectionPlus, ready: false, slice: 'T6' },
  { id: 'lasso', label: 'Lasso (L)', Icon: Lasso, ready: false, slice: 'T6' },
  { id: 'wand', label: 'Baguette magique (W)', Icon: MagicWand, ready: false, slice: 'T6' },
  { id: 'crop', label: 'Recadrage (C)', Icon: Crop, ready: false, slice: 'T8' },
  { id: 'brush', label: 'Brosse (B)', Icon: PaintBrush, ready: false, slice: 'T4' },
  { id: 'spotHealing', label: 'Correcteur localisé (J)', Icon: Bandaids, ready: false, slice: 'T11' },
  { id: 'cloneStamp', label: 'Tampon de duplication (S)', Icon: Stamp, ready: false, slice: 'T11' },
  { id: 'blur', label: 'Flou (R)', Icon: Drop, ready: false, slice: 'T11' },
  { id: 'gradient', label: 'Dégradé (G)', Icon: SquareHalfBottom, ready: false, slice: 'T12' },
  { id: 'shape', label: 'Forme (U)', Icon: Rectangle, ready: false, slice: 'T12' },
  { id: 'type', label: 'Texte (T)', Icon: TextT, ready: false, slice: 'T12' },
  { id: 'eyedropper', label: 'Pipette (I)', Icon: Eyedropper, ready: false, slice: 'T7' },
  { id: 'hand', label: 'Main (H)', Icon: Hand, ready: false, slice: 'T8' },
  { id: 'zoom', label: 'Zoom (Z)', Icon: MagnifyingGlass, ready: false, slice: 'T8' },
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
    {TOOLS.map(({ id, label, Icon, ready, slice }) => (
      <Button
        key={id}
        aria-label={ready ? label : `${label} — à partir de ${slice ?? 'plus tard'}`}
        isDisabled={!ready}
        onPress={() => onToolChange(id)}
        className={[
          'flex h-[28px] w-[28px] items-center justify-center rounded-sm',
          'text-(--color-fg-muted) transition-colors duration-100',
          'data-hovered:bg-(--color-panel-raised) data-hovered:text-(--color-fg)',
          'data-disabled:opacity-25 data-disabled:data-hovered:bg-transparent',
          tool === id ? 'bg-(--color-accent) text-(--color-accent-fg) data-hovered:bg-(--color-accent) data-hovered:text-(--color-accent-fg)' : '',
        ].join(' ')}
      >
        <Icon size={16} weight="regular" />
      </Button>
    ))}
  </Toolbar>
);
