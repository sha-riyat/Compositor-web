import type { CompositorDocument } from '@compositor/model';

/**
 * La comptabilité des transactions d'annulation — **sans la pile**.
 *
 * L'annulation est un no-go explicite du pari T1 ; elle arrive en T3. Mais le
 * contrat de `ToolApi` est figé dès maintenant, donc ce qui est implémenté ici
 * est la partie du contrat que les outils exercent déjà :
 *
 *  - `begin` / `end` s'imbriquent, seul le niveau zéro compte ;
 *  - si le document n'a pas changé entre les deux, rien n'est poussé.
 *
 * Cette seconde règle n'est pas un détail : sans elle, sélectionner un calque
 * ou le cliquer sans le bouger détruirait le rétablissement. Voir
 * `Compositor/Document/DocumentHistory.swift`.
 *
 * En T3, `#commit` remplira une pile d'instantanés à partage structurel
 * (100 entrées, 256 Mio retenus) — le reste de cette classe ne bougera pas.
 */
export class TransactionLog {
  #depth = 0;
  #pendingName = 'Édition';
  #before: CompositorDocument | null = null;
  #hasPending = false;

  begin(name: string, document: CompositorDocument | null): void {
    if (this.#depth === 0) {
      this.#pendingName = name;
      this.#before = document;
      this.#hasPending = true;
    }
    this.#depth++;
  }

  end(document: CompositorDocument | null): void {
    if (this.#depth === 0) return;
    this.#depth--;
    if (this.#depth > 0 || !this.#hasPending) return;

    const before = this.#before;
    this.#before = null;
    this.#hasPending = false;

    // Sélectionner, naviguer, ou une édition sans effet : on ne pousse rien.
    if (before === document) return;
    this.#commit(this.#pendingName);
  }

  get depth(): number {
    return this.#depth;
  }

  /** Les transactions closes, par nom — de quoi vérifier le contrat en test. */
  readonly committed: string[] = [];

  #commit(name: string): void {
    this.committed.push(name);
    // T3 : pousser ici l'entrée { name, before, after } dans la pile.
  }
}
