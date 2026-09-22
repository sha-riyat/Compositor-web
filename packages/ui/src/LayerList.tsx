import { Eye, EyeSlash } from '@phosphor-icons/react';
import { Button, ListBox, ListBoxItem } from 'react-aria-components';
import { useStore } from 'zustand';
import { documentStore, replaceLayer, type Layer } from '@compositor/model';
import { LayerAppearance } from './LayerAppearance.js';

/**
 * Le panneau de calques, version T1 : **liste plate, sans glisser-déposer ni
 * virtualisation**. Les deux arrivent en T5 et T2.
 *
 * Il est construit sur `ListBox` de React Aria dès maintenant, pour que la
 * sélection multiple, la navigation clavier et les rôles ARIA soient acquis
 * quand le glisser-déposer imbriqué s'y greffera.
 *
 * La hauteur de ligne — 52 px — est relevée dans `NativeLayerList.swift`.
 */

export const LayerList = (): React.ReactElement => {
  const document = useStore(documentStore, (s) => s.document);
  const activeLayerId = useStore(documentStore, (s) => s.activeLayerId);

  // Du haut vers le bas à l'écran, alors que le modèle va du bas vers le haut.
  const rows = document === null ? [] : [...document.layers].reverse();

  const toggleVisibility = (layer: Layer): void => {
    const current = documentStore.getState().document;
    if (current === null) return;
    documentStore.setState({
      document: replaceLayer(current, layer.id, (l) => ({ ...l, isVisible: !l.isVisible })),
    });
  };

  return (
    <div className="flex w-[252px] shrink-0 flex-col border-l border-(--color-border) bg-(--color-panel)">
      <header className="flex h-[28px] shrink-0 items-center border-b border-(--color-border) px-2 text-ui font-medium">
        Calques
      </header>

      <LayerAppearance />

      {rows.length === 0 ? (
        <p className="p-3 text-ui text-(--color-fg-faint)">
          Déposez une image PNG sur le canevas.
        </p>
      ) : (
        <ListBox
          aria-label="Calques"
          selectionMode="single"
          selectedKeys={activeLayerId === null ? [] : [activeLayerId]}
          onSelectionChange={(keys) => {
            const first = keys === 'all' ? null : ([...keys][0] ?? null);
            documentStore.setState({ activeLayerId: first === null ? null : String(first) });
          }}
          className="flex flex-1 flex-col gap-0_5 overflow-y-auto p-0_5"
        >
          {rows.map((layer) => (
            <ListBoxItem
              key={layer.id}
              id={layer.id}
              textValue={layer.name}
              className={[
                'flex h-layer-row shrink-0 items-center gap-2 rounded-sm px-2',
                'cursor-default text-ui',
                'data-hovered:bg-(--color-panel-raised)',
                'data-selected:bg-(--color-accent) data-selected:text-(--color-accent-fg)',
              ].join(' ')}
            >
              <Button
                aria-label={layer.isVisible ? `Masquer ${layer.name}` : `Afficher ${layer.name}`}
                onPress={() => toggleVisibility(layer)}
                className="flex h-control w-control shrink-0 items-center justify-center rounded-sm opacity-70 data-hovered:opacity-100"
              >
                {layer.isVisible ? <Eye size={14} /> : <EyeSlash size={14} />}
              </Button>

              <span
                aria-hidden
                className="h-[36px] w-[36px] shrink-0 rounded-sm border border-(--color-border) bg-(--color-panel-sunken)"
              />

              <span className="min-w-0 flex-1 truncate">{layer.name}</span>

              <span className="numeric shrink-0 text-(--color-fg-muted) data-selected:text-(--color-accent-fg)">
                {Math.round(layer.opacity * 100)} %
              </span>
            </ListBoxItem>
          ))}
        </ListBox>
      )}
    </div>
  );
};
