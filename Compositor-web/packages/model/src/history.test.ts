import { beforeEach, describe, expect, test } from 'vitest';
import {
  addLayer,
  beginEdit,
  createDocument,
  createLayer,
  DocumentHistory,
  documentStore,
  edit,
  editDocument,
  endEdit,
  historyDetails,
  historyStore,
  identityTransform,
  insertBlankLayer,
  markSaved,
  moveLayer,
  redo,
  removeLayers,
  renameLayer,
  resetHistory,
  sameDocument,
  setActiveLayer,
  setLayersVisible,
  undo,
  type CompositorDocument,
} from './index.js';

/**
 * Traduction de `CompositorTests/HistoryTests.swift`, et du contrat de
 * transaction que `TransactionLog` tenait depuis T1.
 */

const state = () => documentStore.getState();
const snapshot = (): [CompositorDocument | null, string | null] => [state().document, state().activeLayerId];

beforeEach(() => {
  documentStore.setState({ document: null, activeLayerId: null, selectedLayerIds: [] });
  state().assets.clear();
  resetHistory();
});

const layerDoc = (name: string): CompositorDocument =>
  addLayer(createDocument('d', 100, 100), createLayer('l', name, identityTransform({ width: 10, height: 10 })));

describe('contrat des transactions', () => {
  const bare = () => new DocumentHistory(() => 0);

  test('un cycle qui change le document pousse une entrée', () => {
    const history = bare();
    history.begin('Déplacer le calque', layerDoc('a'), null);
    expect(history.end(layerDoc('b'), null)).toBe(true);
    expect(history.undoName).toBe('Déplacer le calque');
  });

  test('un document inchangé ne pousse rien — sinon sélectionner détruirait le rétablissement', () => {
    const history = bare();
    const same = layerDoc('a');
    history.begin('Sélectionner', same, null);
    expect(history.end(same, 'l')).toBe(false);
  });

  test('un document neuf mais identique en valeur ne pousse rien non plus', () => {
    const history = bare();
    history.begin('Renommer le calque', layerDoc('a'), null);
    expect(history.end(layerDoc('a'), null)).toBe(false);
    expect(sameDocument(layerDoc('a'), layerDoc('a'))).toBe(true);
    expect(sameDocument(layerDoc('a'), layerDoc('b'))).toBe(false);
  });

  test('les cycles imbriqués ne poussent qu’une entrée, au nom du plus externe', () => {
    const history = bare();
    history.begin('Externe', layerDoc('a'), null);
    history.begin('Interne', layerDoc('b'), null);
    expect(history.end(layerDoc('c'), null)).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(history.end(layerDoc('c'), null)).toBe(true);
    expect(history.undoCount).toBe(1);
    expect(history.undoName).toBe('Externe');
  });

  test('un end sans begin est ignoré', () => {
    expect(bare().end(layerDoc('a'), null)).toBe(false);
  });
});

describe('annuler et rétablir', () => {
  /** `everyLayerEditRoundTripsWithSelection`. */
  test('chaque modification revient, avec le calque actif', () => {
    const states = [snapshot()];
    const capture = () => states.push(snapshot());

    edit('Nouveau canevas', () => documentStore.setState({ document: createDocument('d', 800, 600) }));
    capture();
    for (const id of ['a', 'b']) {
      edit('Nouveau calque vide', () => {
        documentStore.setState({ document: insertBlankLayer(state().document!, id, `Calque ${id}`, state().activeLayerId) });
        setActiveLayer(id);
      });
      capture();
    }
    editDocument('Renommer le calque', (d) => renameLayer(d, 'b', 'Premier plan'));
    capture();
    editDocument('Masquer le calque', (d) => setLayersVisible(d, ['b'], false));
    capture();
    editDocument('Réordonner les calques', (d) => moveLayer(d, 'b', 0));
    capture();
    edit('Supprimer le calque', () => {
      documentStore.setState({ document: removeLayers(state().document!, ['b']) });
      setActiveLayer('a');
    });
    capture();

    for (const expected of states.slice(0, -1).reverse()) {
      expect(undo()).toBe(true);
      expect(snapshot()).toEqual(expected);
    }
    expect(undo()).toBe(false);
    for (const expected of states.slice(1)) {
      expect(redo()).toBe(true);
      expect(snapshot()).toEqual(expected);
    }
    expect(redo()).toBe(false);
  });

  /** `navigationNoOpsAndSaveRevisionPreserveHistory`. */
  test('les modifications sans effet gardent le rétablissement ; « modifié » suit la sauvegarde', () => {
    documentStore.setState({ document: layerDoc('Calque 1') });
    markSaved();
    expect(historyStore.getState().isModified).toBe(false);
    editDocument('Renommer le calque', (d) => renameLayer(d, 'l', 'Changé'));
    expect(historyStore.getState().isModified).toBe(true);
    undo();
    expect(historyStore.getState().isModified).toBe(false);

    const count = historyDetails().undoCount;
    editDocument('Renommer le calque', (d) => renameLayer(d, 'l', 'Calque 1'));
    editDocument('Renommer le calque', (d) => renameLayer(d, 'l', '   '));
    editDocument('Réordonner les calques', (d) => moveLayer(d, 'l', 0));
    expect(historyDetails().undoCount).toBe(count);
    expect(historyStore.getState().canRedo).toBe(true);

    redo();
    expect(historyStore.getState().isModified).toBe(true);
    undo();
    editDocument('Masquer le calque', (d) => setLayersVisible(d, ['l'], false));
    expect(historyStore.getState().canRedo).toBe(false);
    expect(historyStore.getState().isModified).toBe(true);
  });

  /** `replacementCanvasAndNestedTransactionsUndoAsOne`. */
  test('une transaction imbriquée s’annule d’un coup, et un canevas remplacé revient', () => {
    documentStore.setState({ document: createDocument('d', 100, 200) });
    beginEdit('Préparer les calques');
    editDocument('Nouveau calque vide', (d) => insertBlankLayer(d, 'x', 'Calque 1'));
    editDocument('Nouveau calque vide', (d) => insertBlankLayer(d, 'y', 'Calque 2'));
    expect(historyStore.getState().canUndo).toBe(false);
    endEdit();
    expect(historyStore.getState().undoName).toBe('Préparer les calques');
    undo();
    expect(state().document?.layers).toEqual([]);
    redo();

    const previous = state().document;
    edit('Nouveau canevas', () => documentStore.setState({ document: createDocument('e', 300, 400) }));
    undo();
    expect(state().document).toBe(previous);
    redo();
    expect(state().document?.width).toBe(300);
  });

  test('pendant un geste en cours, annuler est refusé', () => {
    documentStore.setState({ document: layerDoc('a') });
    editDocument('Renommer le calque', (d) => renameLayer(d, 'l', 'b'));
    beginEdit('Déplacer le calque');
    expect(undo()).toBe(false);
    endEdit();
    expect(undo()).toBe(true);
  });
});

describe('bornes et mémoire', () => {
  const pixels = (side: number) => ({
    width: side, height: side, data: new Uint8ClampedArray(side * side * 4), isOpaque: false,
  });

  /** `historyBoundsEntriesAndUniqueRetainedPixels`. */
  test('au plus N entrées, et aucun octet retenu au-delà de la limite', () => {
    resetHistory({ entries: 2, retainedBytes: 0 });
    const asset = state().assets.add(pixels(8));
    documentStore.setState({
      document: addLayer(createDocument('d', 64, 32), createLayer('l', 'Image', identityTransform({ width: 8, height: 8 }), asset)),
    });
    for (const name of ['A', 'B', 'C']) editDocument('Renommer le calque', (d) => renameLayer(d, 'l', name));
    expect(historyDetails().undoCount).toBe(2);
    expect(historyDetails().retainedBytes).toBe(0);

    editDocument('Supprimer le calque', (d) => removeLayers(d, ['l']));
    expect(historyDetails().undoCount).toBe(0);
    expect(historyDetails().retainedBytes).toBe(0);
  });

  test('les pixels d’un calque supprimé restent tant que l’historique peut le ramener', () => {
    const asset = state().assets.add(pixels(8));
    documentStore.setState({
      document: addLayer(createDocument('d', 64, 32), createLayer('l', 'Image', identityTransform({ width: 8, height: 8 }), asset)),
    });
    editDocument('Supprimer le calque', (d) => removeLayers(d, ['l']));
    expect(state().assets.get(asset)).toBeDefined();
    expect(historyDetails().retainedBytes).toBe(8 * 8 * 4);

    undo();
    expect(state().document?.layers[0]?.asset).toBe(asset);
  });

  test('sorti de l’historique, un calque supprimé libère ses pixels', () => {
    const asset = state().assets.add(pixels(8));
    documentStore.setState({
      document: addLayer(createDocument('d', 64, 32), createLayer('l', 'Image', identityTransform({ width: 8, height: 8 }), asset)),
    });
    editDocument('Supprimer le calque', (d) => removeLayers(d, ['l']));
    const before = state().assets.byteLength;
    resetHistory();
    expect(state().assets.get(asset)).toBeUndefined();
    expect(before - state().assets.byteLength).toBe(8 * 8 * 4);
  });
});
