import { useEffect, useRef } from 'react';
import { Folder } from '@phosphor-icons/react';
import { documentStore, type Layer } from '@compositor/model';
import { renderThumbnail } from './thumbnail.js';

/**
 * La vignette d'une ligne de calque : 36 px, à la densité de l'écran, sur un
 * damier quand l'image a de la transparence — comme dans l'original.
 *
 * Mise en cache par **actif, révision et taille en pixels** : jamais
 * recalculée à chaque rendu React, seulement quand les pixels changent ou que
 * l'écran change de densité. Le cache est borné, les plus anciennes entrées
 * partent en premier.
 */

const SIZE = 36;
const CACHE_LIMIT = 400;
const cache = new Map<string, HTMLCanvasElement>();

const cached = (key: string, build: () => HTMLCanvasElement): HTMLCanvasElement => {
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Réinsertion : l'entrée redevient la plus récente.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const made = build();
  cache.set(key, made);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return made;
};

export const LayerThumbnail = ({ layer }: { readonly layer: Layer }): React.ReactElement => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const assets = documentStore.getState().assets;
  const revision = layer.asset === null ? 0 : assets.revision(layer.asset);

  useEffect(() => {
    const element = canvas.current;
    if (element === null || layer.isGroup) return;

    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(SIZE * dpr);
    element.width = px;
    element.height = px;
    const context = element.getContext('2d');
    if (context === null) return;

    drawChecker(context, px, Math.max(2, Math.round(4 * dpr)));

    if (layer.asset === null) return;
    const buffer = assets.get(layer.asset);
    if (buffer === undefined) return;

    const image = cached(`${layer.asset}:${revision}:${px}`, () => {
      const thumb = renderThumbnail(buffer, px);
      const surface = window.document.createElement('canvas');
      surface.width = thumb.width;
      surface.height = thumb.height;
      surface.getContext('2d')?.putImageData(new ImageData(thumb.data, thumb.width, thumb.height), 0, 0);
      return surface;
    });

    // Centrée, proportions conservées, par-dessus le damier.
    context.drawImage(image, Math.round((px - image.width) / 2), Math.round((px - image.height) / 2));
  }, [layer.asset, layer.isGroup, revision, assets]);

  if (layer.isGroup) {
    return (
      <span
        aria-hidden
        className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-sm border border-(--color-border) bg-(--color-panel-sunken) text-(--color-fg-muted)"
      >
        <Folder size={18} />
      </span>
    );
  }

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className="h-[36px] w-[36px] shrink-0 rounded-sm border border-(--color-border)"
    />
  );
};

const drawChecker = (context: CanvasRenderingContext2D, size: number, cell: number): void => {
  context.fillStyle = '#9a9a9a';
  context.fillRect(0, 0, size, size);
  context.fillStyle = '#7a7a7a';
  for (let y = 0; y < size; y += cell) {
    for (let x = (y / cell) % 2 === 0 ? 0 : cell; x < size; x += cell * 2) {
      context.fillRect(x, y, cell, cell);
    }
  }
};
