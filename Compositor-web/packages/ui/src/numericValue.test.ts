import { describe, expect, test } from 'vitest';
import { clamp, formatNumber, parseNumber, stepNumber } from './numericValue.js';

describe('lecture de ce qui est tapé', () => {
  test('un entier, un décimal, un négatif', () => {
    expect(parseNumber('150')).toBe(150);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('-40')).toBe(-40);
  });

  test('la virgule d’un clavier français vaut le point', () => {
    expect(parseNumber('12,5')).toBe(12.5);
  });

  test('les espaces autour ne comptent pas', () => {
    expect(parseNumber('  42 ')).toBe(42);
  });

  /** `Number('')` vaut 0 : un champ vidé ne doit pas envoyer le calque à l'origine. */
  test('un champ vide n’est pas zéro', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('   ')).toBeNull();
  });

  /** `parseFloat('12abc')` rendrait 12 ; `Double("12abc")` rend nil côté Swift. */
  test('un texte qui commence par un nombre n’en est pas un', () => {
    expect(parseNumber('12abc')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('50%')).toBeNull();
  });

  test('l’infini n’est pas une valeur', () => {
    expect(parseNumber('Infinity')).toBeNull();
  });
});

describe('écriture d’une valeur', () => {
  test('un entier s’écrit sans décimales', () => {
    expect(formatNumber(150)).toBe('150');
    expect(formatNumber(-40)).toBe('-40');
  });

  test('un quasi-entier aussi — l’écart se voit à peine', () => {
    expect(formatNumber(12.004)).toBe('12');
    expect(formatNumber(11.996)).toBe('12');
  });

  test('sinon deux décimales, comme l’original', () => {
    expect(formatNumber(12.5)).toBe('12.50');
    expect(formatNumber(0.333)).toBe('0.33');
  });

  test('jamais de « -0 »', () => {
    expect(formatNumber(-0.001)).toBe('0');
  });
});

describe('flèches', () => {
  test('un pas, ou dix avec Maj', () => {
    expect(stepNumber(100, 1, { shift: false })).toBe(101);
    expect(stepNumber(100, -1, { shift: false })).toBe(99);
    expect(stepNumber(100, 1, { shift: true })).toBe(110);
    expect(stepNumber(100, -1, { shift: true })).toBe(90);
  });

  test('le pas du champ est multiplié par dix, pas remplacé', () => {
    expect(stepNumber(1, 1, { shift: true, step: 0.5 })).toBe(6);
  });

  test('les bornes tiennent', () => {
    expect(stepNumber(95, 1, { shift: true, max: 100 })).toBe(100);
    expect(stepNumber(3, -1, { shift: true, min: 1 })).toBe(1);
  });

  test('clamp sans bornes ne touche à rien', () => {
    expect(clamp(-5)).toBe(-5);
  });
});
