import { CaretDown } from '@phosphor-icons/react';
import { Button, Label, Menu, MenuItem, MenuTrigger, Popover, Slider, SliderThumb, SliderTrack } from 'react-aria-components';
import { useStore } from 'zustand';
import {
  BLEND_MODES,
  BLEND_MODE_LABELS,
  documentStore,
  replaceLayer,
  type BlendMode,
  type Layer,
} from '@compositor/model';
import { setBlendPreview } from './blendPreview.js';
import { NumberField } from './NumberField.js';

/**
 * Mode de fusion et opacité du calque actif.
 *
 * Survoler un mode dans le menu le montre sur le canevas **sans rien écrire** :
 * le calque garde son mode réel, le document reste non modifié, et rien n'entre
 * dans l'historique. Seule la validation écrit.
 */
export const LayerAppearance = (): React.ReactElement | null => {
  const document = useStore(documentStore, (s) => s.document);
  const activeLayerId = useStore(documentStore, (s) => s.activeLayerId);

  const layer =
    document === null || activeLayerId === null
      ? undefined
      : document.layers.find((l) => l.id === activeLayerId);

  // Le bloc reste monté même sans calque actif, désactivé. Sinon la liste
  // sauterait de 56 px sous le pointeur au moment où l'on sélectionne — ce qui
  // se voit surtout quand on enchaîne sélection et glissement.
  if (layer === undefined) return <Placeholder />;

  // `typeof layer` porterait le type déclaré, pas celui affiné par la garde.
  const active: Layer = layer;

  const commit = (change: (l: Layer) => Layer): void => {
    const current = documentStore.getState().document;
    if (current === null) return;
    documentStore.setState({ document: replaceLayer(current, active.id, change) });
  };

  return (
    <div className="flex shrink-0 flex-col gap-1_5 border-b border-(--color-border) px-2 py-2">
      <div className="flex items-center gap-2">
        <span className="w-[42px] shrink-0 text-(--color-fg-muted)">Mode</span>

        <MenuTrigger
          onOpenChange={(open) => {
            // Le menu se ferme : l'aperçu disparaît, quelle qu'en soit la raison.
            if (!open) setBlendPreview(null);
          }}
        >
          <Button className="flex h-control flex-1 items-center justify-between rounded-sm border border-(--color-border) bg-(--color-panel-sunken) px-1_5 text-ui data-hovered:bg-(--color-panel-raised)">
            <span>{BLEND_MODE_LABELS[active.blendMode]}</span>
            <CaretDown size={10} />
          </Button>

          <Popover
            placement="bottom start"
            className="max-h-[320px] overflow-y-auto rounded-md border border-(--color-border) bg-(--color-panel-raised) p-0_5 shadow-lg"
          >
            <Menu
              aria-label="Mode de fusion"
              onAction={(key) => {
                setBlendPreview(null);
                commit((l) => ({ ...l, blendMode: key as BlendMode }));
              }}
              className="flex w-[180px] flex-col outline-none"
            >
              {BLEND_MODES.map((mode) => (
                <MenuItem
                  key={mode}
                  id={mode}
                  textValue={BLEND_MODE_LABELS[mode]}
                  onHoverStart={() => setBlendPreview({ layerId: active.id, mode })}
                  className={[
                    'flex h-control cursor-default items-center rounded-sm px-1_5 text-ui outline-none',
                    'data-hovered:bg-(--color-selection) data-hovered:text-(--color-accent-fg)',
                    'data-focused:bg-(--color-selection) data-focused:text-(--color-accent-fg)',
                    mode === active.blendMode ? 'font-medium' : '',
                  ].join(' ')}
                >
                  {BLEND_MODE_LABELS[mode]}
                </MenuItem>
              ))}
            </Menu>
          </Popover>
        </MenuTrigger>
      </div>

      <div className="flex items-center gap-1">
        <Slider
          aria-label="Opacité"
          value={Math.round(active.opacity * 100)}
          minValue={0}
          maxValue={100}
          onChange={(value) => {
            const next = (Array.isArray(value) ? value[0]! : value) / 100;
            commit((l) => ({ ...l, opacity: next }));
          }}
          className="flex flex-1 items-center gap-2"
        >
          <Label className="w-[42px] shrink-0 text-(--color-fg-muted)">Opacité</Label>
          <SliderTrack className="relative h-control flex-1">
            {({ state }) => (
              <>
                <div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 rounded-sm bg-(--color-panel-sunken)" />
                <div
                  className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-sm bg-(--color-accent)"
                  style={{ width: `${state.getThumbPercent(0) * 100}%` }}
                />
                <SliderThumb className="top-1/2 h-[11px] w-[11px] rounded-full border border-(--color-border) bg-(--color-fg) data-dragging:bg-(--color-accent)" />
              </>
            )}
          </SliderTrack>
        </Slider>

        {/* Le pourcentage se tape aussi, comme dans l'original : un champ de
            44 px suivi de « % ». Il s'applique en quittant le champ. */}
        <NumberField
          label="Opacité en pourcentage"
          hideLabel
          value={Math.round(active.opacity * 100)}
          min={0}
          max={100}
          unit="%"
          widthClass="w-[44px]"
          onChange={(percent) => commit((l) => ({ ...l, opacity: percent / 100 }))}
        />
      </div>
    </div>
  );
};

/** La même hauteur, sans calque à régler. */
const Placeholder = (): React.ReactElement => (
  <div
    aria-hidden
    className="flex shrink-0 flex-col gap-1_5 border-b border-(--color-border) px-2 py-2 opacity-35"
  >
    <div className="flex items-center gap-2">
      <span className="w-[42px] shrink-0 text-(--color-fg-muted)">Mode</span>
      <div className="h-control flex-1 rounded-sm border border-(--color-border) bg-(--color-panel-sunken)" />
    </div>
    {/* Même structure que la vraie ligne, pour que rien ne bouge d'un pixel
        au moment où un calque est sélectionné. */}
    <div className="flex items-center gap-1">
      <div className="flex flex-1 items-center gap-2">
        <span className="w-[42px] shrink-0 text-(--color-fg-muted)">Opacité</span>
        <div className="relative h-control flex-1">
          <div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 rounded-sm bg-(--color-panel-sunken)" />
        </div>
      </div>
      <div className="h-control w-[44px] shrink-0 rounded-sm border border-(--color-border) bg-(--color-panel-sunken)" />
      <span className="text-(--color-fg-muted)">%</span>
    </div>
  </div>
);
