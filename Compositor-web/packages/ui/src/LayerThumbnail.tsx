import { useEffect, useRef } from 'react';
import { Folder } from '@phosphor-icons/react';
import { useStore } from 'zustand';
import { documentStore, type Layer } from '@compositor/model';
import { fittedSize, renderThumbnail } from './thumbnail.js';

/**
 * La miniature d'une ligne de calque, reprise de `CanvasThumbnail.layer`
 * (`Compositor/UI/CanvasThumbnail.swift`) : elle montre **le canevas entier**,
 * avec les pixels du calque là où ils sont posés — « comme Photoshop ».
 *
 * - La forme est celle du canevas, ajustée dans 36 points.
 * - Le fond est un damier sombre, gris 22 % et 32 %, en cases de 6 points.
 * - Le calque est placé comme le canevas le place : autour de son centre,
 *   rotation puis retournement.
 * - Coins arrondis de 3 px ; une bordure d'accent de 2 px **seulement** sur le
 *   calque actif quand il est seul sélectionné (`updateTarget`).
 *
 * La réduction de l'image est mise en cache par **actif, révision et taille
 * en pixels**. Le placement, lui, est refait à chaque changement : il ne coûte
 * qu'un `drawImage` sur quelques dizaines de pixels.
 */

const BOX = 36;
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

export interface LayerThumbnailProps {
  readonly layer: Layer;
  /** Calque actif et seul sélectionné : la miniature porte la bordure d'accent. */
  readonly highlighted: boolean;
}

export const LayerThumbnail = ({ layer, highlighted }: LayerThumbnailProps): React.ReactElement => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const canvasWidth = useStore(documentStore, (s) => s.document?.width ?? 0);
  const canvasHeight = useStore(documentStore, (s) => s.document?.height ?? 0);
  const assets = documentStore.getState().assets;
  const revision = layer.asset === null ? 0 : assets.revision(layer.asset);
  const size = fittedSize(canvasWidth, canvasHeight, BOX);

  useEffect(() => {
    const element = canvas.current;
    if (element === null || layer.isGroup) return;

    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(size.width * dpr);
    element.height = Math.round(size.height * dpr);
    const context = element.getContext('2d');
    if (context === null) return;

    drawChecker(context, element.width, element.height, 6 * dpr);

    if (layer.asset === null || canvasWidth <= 0) return;
    const buffer = assets.get(layer.asset);
    if (buffer === undefined) return;

    // Pixels de miniature par pixel de document.
    const scale = element.width / canvasWidth;
    const { transform } = layer;
    const width = transform.size.width * scale;
    const height = transform.size.height * scale;
    const target = Math.max(1, Math.ceil(Math.max(width, height)));

    const image = cached(`${layer.asset}:${revision}:${target}`, () => {
      const thumb = renderThumbnail(buffer, target);
      const surface = window.document.createElement('canvas');
      surface.width = thumb.width;
      surface.height = thumb.height;
      surface.getContext('2d')?.putImageData(new ImageData(thumb.data, thumb.width, thumb.height), 0, 0);
      return surface;
    });

    // Le même placement que `mat3ForTransform` : centre, rotation, retournement.
    context.save();
    context.translate(
      (transform.origin.x + transform.size.width / 2) * scale,
      (transform.origin.y + transform.size.height / 2) * scale,
    );
    context.rotate(transform.radians);
    context.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, -width / 2, -height / 2, width, height);
    context.restore();
  }, [layer.asset, layer.isGroup, layer.transform, revision, assets, canvasWidth, size.width, size.height]);

  // Les dossiers gardent une icône carrée, comme dans l'original.
  if (layer.isGroup) {
    return (
      <span
        aria-hidden
        className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[3px] bg-(--color-panel-sunken) text-(--color-fg-muted)"
      >
        <Folder size={18} />
      </span>
    );
  }

  return (
    <canvas
      ref={canvas}
      aria-hidden
      data-role="layer-thumbnail"
      style={{ width: size.width, height: size.height }}
      className={[
        'shrink-0 rounded-[3px]',
        // Dessinée à l'intérieur, par-dessus l'image, comme la bordure d'un CALayer.
        highlighted ? 'outline-2 outline-offset-[-2px] outline-(--color-accent)' : '',
      ].join(' ')}
    />
  );
};

/** Gris 22 % au fond, 32 % une case sur deux — `CanvasThumbnail.layer`. */
const drawChecker = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  tile: number,
): void => {
  context.fillStyle = 'rgb(56 56 56)';
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgb(82 82 82)';
  for (let row = 0; row * tile < height; row++) {
    for (let column = 0; column * tile < width; column++) {
      if ((row + column) % 2 === 0) context.fillRect(column * tile, row * tile, tile, tile);
    }
  }
};
