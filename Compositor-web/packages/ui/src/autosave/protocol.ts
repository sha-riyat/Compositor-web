import type { CompositorDocument, LayerId, PixelBuffer } from '@compositor/model';

/** Les messages échangés avec le worker de sauvegarde automatique. */

export const AUTOSAVE_FILE = 'autosave.cwa';

export interface AutosaveImage {
  readonly id: string;
  readonly revision: number;
  /** Absent si le worker a déjà reçu cette révision. */
  readonly buffer?: PixelBuffer;
}

export type AutosaveRequest =
  | {
      readonly type: 'save';
      readonly document: CompositorDocument;
      readonly activeLayerId: LayerId | null;
      readonly modified: boolean;
      readonly images: readonly AutosaveImage[];
    }
  | { readonly type: 'clear' };

export type AutosaveReply =
  | { readonly type: 'saved'; readonly bytes: number }
  | { readonly type: 'cleared' }
  | { readonly type: 'failed'; readonly message: string };
