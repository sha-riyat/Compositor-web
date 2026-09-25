import type { AssetId, LayerId } from './layer.js';
import type { CompositorDocument } from './document.js';

/**
 * La pile d'annulation, reprise de `Compositor/Document/DocumentHistory.swift`.
 *
 * Chaque entrée garde un instantané **avant** et **après**. Un instantané est
 * le document **et** le calque actif : annuler rétablit aussi la sélection.
 * Les documents sont immuables et ne contiennent que des `AssetId` : deux
 * instantanés partagent leurs pixels sans les copier (invariant ③).
 *
 * `begin`/`end` s'imbriquent, seul le niveau zéro compte, et un document
 * inchangé ne pousse rien — sinon sélectionner un calque détruirait le
 * rétablissement.
 */

export interface HistorySnapshot {
  readonly document: CompositorDocument | null;
  readonly activeLayerId: LayerId | null;
  /** Identifie l'état pour `isModified`, comme le `UUID` de l'original. */
  readonly revision: number;
}

interface Entry {
  readonly name: string;
  readonly before: HistorySnapshot;
  readonly after: HistorySnapshot;
}

export interface HistoryLimits {
  readonly entries: number;
  /** Octets de pixels que **seul** l'historique retient. */
  readonly retainedBytes: number;
}

export const DEFAULT_HISTORY_LIMITS: HistoryLimits = {
  entries: 100,
  retainedBytes: 256 * 1024 * 1024,
};

export class DocumentHistory {
  readonly #limits: HistoryLimits;
  /** La taille en octets d'un actif ; `0` s'il n'existe plus. */
  readonly #sizeOf: (id: AssetId) => number;
  #past: Entry[] = [];
  #future: Entry[] = [];
  #revision = 0;
  #nextRevision = 1;
  #savedRevision = 0;
  #pending: HistorySnapshot | null = null;
  #pendingName = 'Édition';
  #depth = 0;

  constructor(sizeOf: (id: AssetId) => number, limits: HistoryLimits = DEFAULT_HISTORY_LIMITS) {
    this.#sizeOf = sizeOf;
    this.#limits = { entries: Math.max(0, limits.entries), retainedBytes: Math.max(0, limits.retainedBytes) };
  }

  get canUndo(): boolean {
    return this.#depth === 0 && this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#depth === 0 && this.#future.length > 0;
  }

  get undoName(): string {
    return this.#past.at(-1)?.name ?? '';
  }

  get redoName(): string {
    return this.#future.at(-1)?.name ?? '';
  }

  get undoCount(): number {
    return this.#past.length;
  }

  get isModified(): boolean {
    return this.#revision !== this.#savedRevision;
  }

  /** Une transaction est-elle ouverte ? Annuler est alors impossible. */
  get isEditing(): boolean {
    return this.#depth > 0;
  }

  markSaved(): void {
    this.#savedRevision = this.#revision;
  }

  reset(): void {
    this.#past = [];
    this.#future = [];
    this.#pending = null;
    this.#depth = 0;
    this.#revision = this.#nextRevision++;
    this.#savedRevision = this.#revision;
  }

  begin(name: string, document: CompositorDocument | null, activeLayerId: LayerId | null): void {
    if (this.#depth === 0) {
      this.#pending = { document, activeLayerId, revision: this.#revision };
      this.#pendingName = name;
    }
    this.#depth++;
  }

  /** Rend `true` si une entrée a été poussée. */
  end(document: CompositorDocument | null, activeLayerId: LayerId | null): boolean {
    if (this.#depth === 0) return false;
    this.#depth--;
    const before = this.#pending;
    if (this.#depth > 0 || before === null) return false;
    this.#pending = null;
    if (sameDocument(before.document, document)) return false;

    this.#revision = this.#nextRevision++;
    this.#past.push({
      name: this.#pendingName,
      before,
      after: { document, activeLayerId, revision: this.#revision },
    });
    this.#future = [];
    this.#trim(document);
    return true;
  }

  undo(): HistorySnapshot | null {
    if (!this.canUndo) return null;
    const entry = this.#past.pop()!;
    this.#future.push(entry);
    this.#revision = entry.before.revision;
    this.#trim(entry.before.document);
    return entry.before;
  }

  redo(): HistorySnapshot | null {
    if (!this.canRedo) return null;
    const entry = this.#future.pop()!;
    this.#past.push(entry);
    this.#revision = entry.after.revision;
    this.#trim(entry.after.document);
    return entry.after;
  }

  /** Tous les actifs que l'historique référence, pour la collecte. */
  referencedAssets(): Set<AssetId> {
    const ids = new Set<AssetId>();
    for (const entry of [...this.#past, ...this.#future]) {
      for (const snapshot of [entry.before, entry.after]) collectAssets(snapshot.document, ids);
    }
    if (this.#pending !== null) collectAssets(this.#pending.document, ids);
    return ids;
  }

  /** Octets retenus **seulement** par l'historique, hors document courant. */
  retainedBytes(current: CompositorDocument | null): number {
    const seen = new Set<AssetId>();
    collectAssets(current, seen);
    let bytes = 0;
    for (const id of this.referencedAssets()) {
      if (seen.has(id)) continue;
      seen.add(id);
      bytes += this.#sizeOf(id);
    }
    return bytes;
  }

  #trim(current: CompositorDocument | null): void {
    while (
      this.#past.length + this.#future.length > this.#limits.entries ||
      this.retainedBytes(current) > this.#limits.retainedBytes
    ) {
      if (this.#past.length > 0) this.#past.shift();
      else if (this.#future.length > 0) this.#future.shift();
      else break;
    }
  }
}

const collectAssets = (document: CompositorDocument | null, into: Set<AssetId>): void => {
  for (const layer of document?.layers ?? []) if (layer.asset !== null) into.add(layer.asset);
};

/**
 * Égalité de valeur, comme le `!=` de l'original sur des structures Swift.
 * L'identité ne suffit pas : une opération peut rendre un document neuf mais
 * identique, et ce ne doit pas être une entrée.
 */
export const sameDocument = (a: CompositorDocument | null, b: CompositorDocument | null): boolean => {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.id !== b.id || a.width !== b.width || a.height !== b.height || a.resolution !== b.resolution) return false;
  if (a.layers.length !== b.layers.length) return false;
  return a.layers.every((layer, i) => {
    const other = b.layers[i]!;
    if (layer === other) return true;
    const t = layer.transform;
    const u = other.transform;
    return (
      layer.id === other.id && layer.name === other.name && layer.asset === other.asset &&
      layer.isVisible === other.isVisible && layer.parentId === other.parentId && layer.isGroup === other.isGroup &&
      layer.opacity === other.opacity && layer.blendMode === other.blendMode &&
      t.origin.x === u.origin.x && t.origin.y === u.origin.y &&
      t.size.width === u.size.width && t.size.height === u.size.height &&
      t.radians === u.radians && t.flipX === u.flipX && t.flipY === u.flipY && t.sampling === u.sampling
    );
  });
};
