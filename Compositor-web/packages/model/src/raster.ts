import { createPixelBuffer, isFullyOpaque, type PixelBuffer } from './assets.js';

/**
 * Le raster tuilé, repris de `RasterSnapshot.swift` : une image de base
 * **immuable**, plus des tuiles de remplacement de 256 px. Peindre ne touche
 * jamais la base ni les tuiles existantes : chaque trait produit un raster
 * neuf qui **partage** tout ce qu'il n'a pas repeint.
 *
 * C'est ce qui garde l'historique juste et léger : l'instantané d'avant le
 * trait référence l'ancien raster, intact, et les deux ne diffèrent que par
 * les tuiles touchées.
 *
 * Octets RGBA 8 bits **prémultipliés**, comme `PixelBuffer`. Une tuile de bord
 * a exactement la taille de ce qui reste de l'image, pas 256 × 256.
 */

export const TILE_SIZE = 256;

export interface TiledRaster {
  readonly kind: 'tiled';
  readonly width: number;
  readonly height: number;
  /** L'image d'origine, partagée ; `null` pour un calque peint à partir de rien. */
  readonly base: PixelBuffer | null;
  /** Les tuiles repeintes, par clé `tileKey` ; elles priment sur la base. */
  readonly tiles: ReadonlyMap<number, Uint8ClampedArray<ArrayBuffer>>;
  /** Octets que ce raster est le seul à apporter, pour le budget de l'historique. */
  readonly ownBytes: number;
}

/** Ce qu'un actif peut contenir : une image contiguë, ou un raster tuilé. */
export type PixelSource = PixelBuffer | TiledRaster;

export const isTiled = (source: PixelSource): source is TiledRaster =>
  (source as Partial<TiledRaster>).kind === 'tiled';

export interface TileGrid {
  readonly columns: number;
  readonly rows: number;
}

export const tileGrid = (width: number, height: number): TileGrid => ({
  columns: Math.ceil(width / TILE_SIZE),
  rows: Math.ceil(height / TILE_SIZE),
});

export const tileKey = (grid: TileGrid, column: number, row: number): number => row * grid.columns + column;

export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Le rectangle, en pixels du raster, que couvre une tuile. */
export const tileRect = (width: number, height: number, key: number): TileRect => {
  const { columns } = tileGrid(width, height);
  const x = (key % columns) * TILE_SIZE;
  const y = Math.floor(key / columns) * TILE_SIZE;
  return { x, y, width: Math.min(TILE_SIZE, width - x), height: Math.min(TILE_SIZE, height - y) };
};

/** Une copie des pixels d'une tuile, telle que la source l'affiche. */
export const readTile = (
  source: PixelSource | null,
  width: number,
  height: number,
  key: number,
): Uint8ClampedArray<ArrayBuffer> => {
  const rect = tileRect(width, height, key);
  if (source !== null && isTiled(source)) {
    const tile = source.tiles.get(key);
    if (tile !== undefined) return new Uint8ClampedArray(tile);
  }
  const base = source === null ? null : isTiled(source) ? source.base : source;
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  if (base === null) return out;
  for (let row = 0; row < rect.height; row++) {
    const from = ((rect.y + row) * base.width + rect.x) * 4;
    out.set(base.data.subarray(from, from + rect.width * 4), row * rect.width * 4);
  }
  return out;
};

/**
 * Un raster neuf : la source, plus les tuiles remplacées. La source n'est
 * pas modifiée ; ses tuiles non remplacées sont partagées, pas copiées.
 */
export const replaceTiles = (
  source: PixelSource | null,
  width: number,
  height: number,
  replacements: ReadonlyMap<number, Uint8ClampedArray<ArrayBuffer>>,
): TiledRaster => {
  const base = source === null ? null : isTiled(source) ? source.base : source;
  const tiles = new Map(source !== null && isTiled(source) ? source.tiles : []);
  let ownBytes = source !== null && !isTiled(source) ? source.data.byteLength : 0;
  for (const [key, tile] of replacements) {
    tiles.set(key, tile);
    ownBytes += tile.byteLength;
  }
  return { kind: 'tiled', width, height, base, tiles, ownBytes };
};

/**
 * L'image contiguë — pour l'export, l'enregistrement et les miniatures. Comme
 * l'original, elle n'est produite qu'à la demande, jamais au relâchement.
 */
export const materialize = (raster: TiledRaster): PixelBuffer => {
  if (raster.tiles.size === 0 && raster.base !== null) return raster.base;
  const buffer = createPixelBuffer(raster.width, raster.height);
  if (raster.base !== null) buffer.data.set(raster.base.data);
  for (const [key, tile] of raster.tiles) {
    const rect = tileRect(raster.width, raster.height, key);
    for (let row = 0; row < rect.height; row++) {
      buffer.data.set(
        tile.subarray(row * rect.width * 4, (row + 1) * rect.width * 4),
        ((rect.y + row) * raster.width + rect.x) * 4,
      );
    }
  }
  return { ...buffer, isOpaque: isFullyOpaque(buffer.data) };
};
