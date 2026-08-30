import {
  parseScore,
  isDoubleBagel,
  isComeback,
  isSuperTiebreakWin,
} from './score';

describe('parseScore', () => {
  it('lee un partido normal y lo deja desde la perspectiva del ganador', () => {
    const r = parseScore('6-3, 6-1');
    expect(r.perspectiveKnown).toBe(true);
    expect(r.sets).toEqual([
      [6, 3],
      [6, 1],
    ]);
  });

  it('da vuelta el marcador cuando viene desde el lado del perdedor', () => {
    const r = parseScore('3-6, 1-6');
    expect(r.perspectiveKnown).toBe(true);
    expect(r.sets).toEqual([
      [6, 3],
      [6, 1],
    ]);
  });

  it('reconoce el super tiebreak entre corchetes', () => {
    const r = parseScore('7-6, 4-6, [10-7]');
    expect(r.hasSuperTiebreak).toBe(true);
    expect(r.perspectiveKnown).toBe(true);
    expect(r.sets[2]).toEqual([10, 7]);
  });

  it('marca W.O. sin inventar sets', () => {
    const r = parseScore('W.O.');
    expect(r.isWalkover).toBe(true);
    expect(r.sets).toEqual([]);
    expect(r.perspectiveKnown).toBe(false);
  });

  it('no adivina la perspectiva en un retiro (el ganador puede ir abajo)', () => {
    // Final de categoría A: Hernán ganó el primer set y se retiró.
    const r = parseScore('4-6 (Retiro)');
    expect(r.isRetirement).toBe(true);
    expect(r.perspectiveKnown).toBe(false);
  });

  it('tolera string vacío o nulo', () => {
    expect(parseScore(null).sets).toEqual([]);
    expect(parseScore('').perspectiveKnown).toBe(false);
  });
});

describe('logros derivados del marcador', () => {
  it('rosquilla solo con 6-0 6-0', () => {
    expect(isDoubleBagel(parseScore('6-0, 6-0'))).toBe(true);
    expect(isDoubleBagel(parseScore('0-6, 0-6'))).toBe(true); // perspectiva invertida
    expect(isDoubleBagel(parseScore('6-0, 6-1'))).toBe(false);
    expect(isDoubleBagel(parseScore('6-0, 6-0, 6-0'))).toBe(false);
  });

  it('remontada cuando el ganador pierde el primer set', () => {
    expect(isComeback(parseScore('1-6, 6-4, 6-4'))).toBe(true);
    expect(isComeback(parseScore('6-4, 6-4'))).toBe(false);
    // Desde el lado del perdedor: el ganador igual perdió el primer set.
    expect(isComeback(parseScore('6-1, 4-6, 4-6'))).toBe(true);
  });

  it('maratonista solo si el partido se definió en super tiebreak', () => {
    expect(isSuperTiebreakWin(parseScore('7-5, 1-6, [10-6]'))).toBe(true);
    expect(isSuperTiebreakWin(parseScore('6-4, 7-5'))).toBe(false);
  });

  it('no otorga nada cuando no se puede saber la perspectiva', () => {
    const wo = parseScore('W.O.');
    expect(isDoubleBagel(wo)).toBe(false);
    expect(isComeback(wo)).toBe(false);
    expect(isSuperTiebreakWin(wo)).toBe(false);
  });
});
