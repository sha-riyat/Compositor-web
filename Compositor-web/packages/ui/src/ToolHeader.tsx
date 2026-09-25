import { LinkSimple } from '@phosphor-icons/react';
import { useStore } from 'zustand';
import {
  beginEdit,
  documentStore,
  editDocument,
  endEdit,
  replaceLayer,
  uiStore,
  type Layer,
  type ToolId,
} from '@compositor/model';
import { NumberField } from './NumberField.js';

/**
 * L'en-tête d'outil, contextuel.
 *
 * Relevé sur l'application macOS : il est **toujours présent**, et affiche
 * `Sélectionner un outil` quand aucun outil n'est actif — jamais une barre
 * vide. Chaque outil y met ses propres réglages.
 *
 * Pour l'outil Déplacer, l'original affiche :
 *
 *     Transform | ○ Auto Select | ☑ Show Controls | X Y W H | [🔗] | Scale % | ° | Sampling
 *
 * Ce qui manque encore ici : l'échelle en pourcentage, l'angle, le filtre de
 * rééchantillonnage, les retournements, et surtout **`Cancel` / `Apply`** — car
 * sur macOS une transformation est un *mode* qui reste en attente jusqu'à
 * validation, alors que notre outil Déplacer écrit directement. C'est une
 * différence de fond, reprise en T8.
 */

const TOOL_LABELS: Partial<Record<ToolId, string>> = {
  idle: 'Sélectionner un outil',
  move: 'Transformation',
  marquee: 'Rectangle de sélection',
  lasso: 'Lasso',
  wand: 'Baguette magique',
  crop: 'Recadrage',
  brush: 'Brosse',
  spotHealing: 'Correcteur localisé',
  cloneStamp: 'Tampon de duplication',
  blur: 'Flou',
  gradient: 'Dégradé',
  shape: 'Forme',
  type: 'Texte',
  eyedropper: 'Pipette',
  hand: 'Main',
  zoom: 'Zoom',
};

export const ToolHeader = (): React.ReactElement => {
  const tool = useStore(uiStore, (s) => s.tool);

  return (
    <div className="flex h-tool-header shrink-0 items-center gap-3 border-b border-(--color-border) bg-(--color-panel) px-2 text-ui">
      <span className="shrink-0 font-medium">{TOOL_LABELS[tool] ?? ''}</span>
      {tool === 'move' ? <MoveOptions /> : null}
    </div>
  );
};

const MoveOptions = (): React.ReactElement => {
  const autoSelect = useStore(uiStore, (s) => s.autoSelect);
  const showsTransformBox = useStore(uiStore, (s) => s.showsTransformBox);
  const lockRatio = useStore(uiStore, (s) => s.locksTransformRatio);
  const document = useStore(documentStore, (s) => s.document);
  const activeLayerId = useStore(documentStore, (s) => s.activeLayerId);

  const layer =
    document === null || activeLayerId === null
      ? undefined
      : document.layers.find((l) => l.id === activeLayerId);

  // L'original tape dans un brouillon de transformation, validé en une fois
  // (`transformEdit.draft`). Sans ce mode — prévu en T8 —, l'équivalent fidèle
  // est une entrée par séjour dans le champ : taper `150` n'en coûte qu'une.
  const startTyping = (): void => beginEdit('Transformer le calque');

  const edit = (change: (l: Layer) => Layer): void => {
    if (activeLayerId === null) return;
    editDocument('Transformer le calque', (document) => replaceLayer(document, activeLayerId, change));
  };

  return (
    <>
      <Toggle
        label="Sélection auto"
        checked={autoSelect}
        onChange={(autoSelect) => uiStore.setState({ autoSelect })}
      />
      <Toggle
        label="Afficher les poignées"
        checked={showsTransformBox}
        onChange={(showsTransformBox) => uiStore.setState({ showsTransformBox })}
      />

      {/* Comme `TransformValueField` : chaque frappe qui forme un nombre
          s'applique, le calque suit pendant qu'on tape. */}
      <div className="flex items-center gap-1_5">
        <NumberField
          label="X"
          value={layer?.transform.origin.x ?? 0}
          disabled={layer === undefined}
          applyWhileTyping
          onEditStart={startTyping}
          onEditEnd={endEdit}
          onChange={(x) =>
            edit((l) => ({ ...l, transform: { ...l.transform, origin: { ...l.transform.origin, x } } }))
          }
        />
        <NumberField
          label="Y"
          value={layer?.transform.origin.y ?? 0}
          disabled={layer === undefined}
          applyWhileTyping
          onEditStart={startTyping}
          onEditEnd={endEdit}
          onChange={(y) =>
            edit((l) => ({ ...l, transform: { ...l.transform, origin: { ...l.transform.origin, y } } }))
          }
        />
        <NumberField
          label="L"
          value={layer?.transform.size.width ?? 0}
          disabled={layer === undefined}
          applyWhileTyping
          onEditStart={startTyping}
          onEditEnd={endEdit}
          min={1}
          onChange={(width) =>
            edit((l) => {
              const height = lockRatio
                ? (l.transform.size.height / l.transform.size.width) * width
                : l.transform.size.height;
              return { ...l, transform: { ...l.transform, size: { width, height } } };
            })
          }
        />
        <NumberField
          label="H"
          value={layer?.transform.size.height ?? 0}
          disabled={layer === undefined}
          applyWhileTyping
          onEditStart={startTyping}
          onEditEnd={endEdit}
          min={1}
          onChange={(height) =>
            edit((l) => {
              const width = lockRatio
                ? (l.transform.size.width / l.transform.size.height) * height
                : l.transform.size.width;
              return { ...l, transform: { ...l.transform, size: { width, height } } };
            })
          }
        />

        {/* Le verrou de ratio est un bouton chaîne bleu quand il est actif,
            et non une case à cocher — c'est ce que montre l'original. */}
        <button
          type="button"
          aria-label="Conserver les proportions"
          aria-pressed={lockRatio}
          onClick={() => uiStore.setState({ locksTransformRatio: !lockRatio })}
          className={[
            'flex h-control w-[26px] shrink-0 items-center justify-center rounded-sm',
            lockRatio
              ? 'bg-(--color-accent) text-(--color-accent-fg)'
              : 'text-(--color-fg-muted) hover:bg-(--color-panel-raised)',
          ].join(' ')}
        >
          <LinkSimple size={13} />
        </button>
      </div>
    </>
  );
};

interface ToggleProps {
  readonly label: string;
  readonly checked: boolean;
  onChange(next: boolean): void;
}

const Toggle = ({ label, checked, onChange }: ToggleProps): React.ReactElement => (
  <label className="flex shrink-0 cursor-default items-center gap-1_5">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="h-[13px] w-[13px] accent-(--color-accent)"
    />
    <span className="text-(--color-fg-muted)">{label}</span>
  </label>
);
