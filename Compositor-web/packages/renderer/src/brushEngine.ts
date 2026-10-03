import {
  BrushStroke,
  type AssetId,
  type BrushSettings,
  type LayerId,
  type PaintStroke,
  type RasterHandoff,
  type Point,
  type StrokeTarget,
} from '@compositor/model';
import { createBrushPrograms, GpuPaintStroke } from './gpuStroke.js';
import { StrokePreview } from './strokePreview.js';
import type { TextureCache } from './textures.js';

/**
 * Le choix du moteur de peinture. Le GPU d'abord, comme l'original peint
 * avec Metal ; le processeur à défaut, si la carte ne sait pas écrire dans
 * des textures flottantes. Le moteur processeur sert aussi de référence aux
 * tests : les traductions des tests Swift le vérifient, et le GPU lui est
 * comparé pixel par pixel.
 */
export class BrushEngine {
  readonly preview: StrokePreview;
  readonly #gl: WebGL2RenderingContext;
  readonly #textures: TextureCache;
  #programs: ReturnType<typeof createBrushPrograms> | undefined;
  /** Faux : le processeur peint, même si le GPU le pourrait. Pour les tests. */
  preferGpu = true;

  constructor(gl: WebGL2RenderingContext, textures: TextureCache) {
    this.#gl = gl;
    this.#textures = textures;
    this.preview = new StrokePreview(gl, textures);
  }

  /** Le moteur qu'un trait commencé maintenant utiliserait. */
  get engine(): 'gpu' | 'cpu' {
    return this.preferGpu && this.#gpu() !== null ? 'gpu' : 'cpu';
  }

  start(layerId: LayerId, asset: AssetId | null, target: StrokeTarget, settings: BrushSettings): PaintStroke {
    this.preview.begin(layerId, asset, target.width, target.height);
    const programs = this.preferGpu ? this.#gpu() : null;
    if (programs === null) return new CpuPaintStroke(this.preview, new BrushStroke(target, settings));
    const source = asset === null ? undefined : this.#textures.get(asset);
    const usable = source !== undefined && source.width === target.width && source.height === target.height;
    return new GpuPaintStroke(this.#gl, programs, this.preview, usable ? source.texture : null, target, settings);
  }

  #gpu(): ReturnType<typeof createBrushPrograms> {
    if (this.#programs === undefined) this.#programs = createBrushPrograms(this.#gl);
    return this.#programs;
  }
}

/** Le repli : le trait est calculé par le processeur, ses tuiles téléversées dans l'aperçu. */
class CpuPaintStroke implements PaintStroke {
  readonly #preview: StrokePreview;
  readonly #stroke: BrushStroke;

  constructor(preview: StrokePreview, stroke: BrushStroke) {
    this.#preview = preview;
    this.#stroke = stroke;
  }

  append(point: Point): void {
    this.#stroke.append(point);
  }

  present(): void {
    this.#preview.update(this.#stroke.takeDirty());
  }

  finish(): RasterHandoff {
    // La fin provisoire devient courbe, et l'aperçu reçoit ces dernières tuiles :
    // sa texture va représenter le raster, elle doit lui être égale.
    this.#stroke.flush();
    this.present();
    const raster = this.#stroke.commit();
    return { step: () => raster, complete: () => raster };
  }

  adopt(asset: AssetId): void {
    this.#preview.commit(asset);
  }

  cancel(): void {
    this.#preview.cancel();
  }
}
