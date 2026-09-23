import { describe, expect, test } from 'vitest';
import { createDocument, addLayer, createLayer, identityTransform } from '@compositor/model';
import { TransactionLog } from './history.js';

/**
 * Traduction de la partie de `Compositor/CompositorTests/HistoryTests.swift`
 * qui porte sur le **contrat** des transactions — ce que T1 implémente.
 *
 * La pile d'annulation elle-même est un no-go du pari et arrive en T3 ; les
 * tests d'annulation/rétablissement suivront avec elle.
 */

const doc = (name: string) =>
  addLayer(
    createDocument('d', 100, 100),
    createLayer(name, name, identityTransform({ width: 10, height: 10 })),
  );

describe('contrat des transactions', () => {
  test('un cycle qui change le document pousse une entrée', () => {
    const log = new TransactionLog();
    const before = doc('a');
    log.begin('Déplacer le calque', before);
    log.end(doc('b'));
    expect(log.committed).toEqual(['Déplacer le calque']);
  });

  test("un document inchangé ne pousse rien — sinon sélectionner détruirait le rétablissement", () => {
    const log = new TransactionLog();
    const unchanged = doc('a');
    log.begin('Sélectionner', unchanged);
    log.end(unchanged);
    expect(log.committed).toEqual([]);
  });

  test('les cycles imbriqués ne poussent qu’une entrée, au nom du plus externe', () => {
    const log = new TransactionLog();
    const before = doc('a');
    log.begin('Externe', before);
    log.begin('Interne', doc('b'));
    log.end(doc('c'));
    expect(log.committed).toEqual([]);
    expect(log.depth).toBe(1);
    log.end(doc('d'));
    expect(log.committed).toEqual(['Externe']);
  });

  test('un end sans begin est ignoré', () => {
    const log = new TransactionLog();
    log.end(doc('a'));
    expect(log.committed).toEqual([]);
    expect(log.depth).toBe(0);
  });

  test('la profondeur revient à zéro après un cycle complet', () => {
    const log = new TransactionLog();
    log.begin('Édition', doc('a'));
    expect(log.depth).toBe(1);
    log.end(doc('b'));
    expect(log.depth).toBe(0);
  });

  test('un document nul de part et d’autre ne pousse rien', () => {
    const log = new TransactionLog();
    log.begin('Édition', null);
    log.end(null);
    expect(log.committed).toEqual([]);
  });
});
