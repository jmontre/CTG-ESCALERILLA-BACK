import {
  categoryOf,
  categoryBounds,
  nextCategoryDown,
  categoryRank,
  categoriesOf,
  getLevel,
  ladderRows,
  canChallengePosition,
} from './ladder';

describe('categorías', () => {
  it('v2 tiene 3 categorías y la última no tiene tope', () => {
    expect(categoriesOf('v2')).toEqual(['A', 'B', 'C']);
    expect(categoryOf(1)).toBe('A');
    expect(categoryOf(14)).toBe('A');
    expect(categoryOf(15)).toBe('B');
    expect(categoryOf(28)).toBe('B');
    expect(categoryOf(29)).toBe('C');
    expect(categoryOf(46)).toBe('C');
    expect(categoryOf(120)).toBe('C'); // la escalerilla puede crecer
  });

  it('legacy4 conserva los rangos con los que se jugó el 1er semestre 2026', () => {
    expect(categoriesOf('legacy4')).toEqual(['A', 'B', 'C', 'D']);
    expect(categoryOf(12, 'legacy4')).toBe('A');
    expect(categoryOf(13, 'legacy4')).toBe('B');
    expect(categoryOf(36, 'legacy4')).toBe('C');
    expect(categoryOf(37, 'legacy4')).toBe('D');
    expect(categoryOf(48, 'legacy4')).toBe('D');
    // Fuera de los 48 puestos que tenía ese esquema.
    expect(categoryOf(49, 'legacy4')).toBeNull();
  });

  it('el mismo puesto cambia de categoría entre esquemas', () => {
    // Quien cerró el 1er semestre en el #14 era B; en el esquema nuevo es A.
    expect(categoryOf(14, 'legacy4')).toBe('B');
    expect(categoryOf(14, 'v2')).toBe('A');
  });

  it('ignora a quien está fuera de la escalerilla y a los admins', () => {
    expect(categoryOf(null)).toBeNull();
    expect(categoryOf(0)).toBeNull();
    expect(categoryOf(1001)).toBeNull();
  });

  it('categoryBounds da el rango de cada categoría', () => {
    expect(categoryBounds('A')).toEqual({ from: 1, to: 14 });
    expect(categoryBounds('B')).toEqual({ from: 15, to: 28 });
    expect(categoryBounds('C')).toEqual({ from: 29, to: null });
    expect(categoryBounds('D')).toBeNull(); // no existe en v2
    expect(categoryBounds('D', 'legacy4')).toEqual({ from: 37, to: 48 });
  });

  it('nextCategoryDown se detiene en la última', () => {
    expect(nextCategoryDown('A')).toBe('B');
    expect(nextCategoryDown('B')).toBe('C');
    expect(nextCategoryDown('C')).toBeNull();
  });

  it('categoryRank ordena de la más alta a la más baja', () => {
    expect(categoryRank('A')).toBeLessThan(categoryRank('B'));
    expect(categoryRank('B')).toBeLessThan(categoryRank('C'));
  });
});

describe('filas de la pirámide (= niveles)', () => {
  // La escalerilla real del 2do semestre 2026.
  const N = 46;

  it('reparte las filas como se dibujan en la pantalla', () => {
    expect(ladderRows(N)).toEqual([
      [1],
      [2, 3],
      [4, 5, 6],
      [7, 8, 9, 10],
      [11, 12, 13, 14], //  ← cierra categoría A
      [15, 16, 17],
      [18, 19, 20, 21],
      [22, 23, 24, 25, 26, 27, 28], // ← cierra categoría B
      [29, 30, 31],
      [32, 33, 34, 35],
      [36, 37, 38, 39, 40],
      [41, 42, 43, 44, 45, 46],
    ]);
  });

  it('cubre todos los puestos, sin repetir ni saltarse ninguno', () => {
    for (const size of [12, 20, 28, 46, 60]) {
      const flat = ladderRows(size).flat();
      expect(flat).toEqual(Array.from({ length: size }, (_, i) => i + 1));
    }
  });

  it('el nivel es el número de fila', () => {
    expect(getLevel(1, N)).toBe(1);
    expect(getLevel(3, N)).toBe(2);
    expect(getLevel(10, N)).toBe(4);
    expect(getLevel(11, N)).toBe(5);
    expect(getLevel(17, N)).toBe(6);
    expect(getLevel(46, N)).toBe(12);
  });

  it('el #17 llega hasta el #11, no hasta el #10', () => {
    // Caso reportado desde la app: el #17 está en la fila [15,16,17] y la fila
    // de arriba es [11,12,13,14]. El #10 está DOS filas más arriba, así que la
    // zona de desafío no puede ofrecerlo.
    const alcanzables = [];
    for (let p = 1; p <= N; p++)
      if (canChallengePosition(17, p, N)) alcanzables.push(p);
    expect(alcanzables).toEqual([11, 12, 13, 14, 15, 16]);
    expect(canChallengePosition(17, 10, N)).toBe(false);
  });

  it('no se puede desafiar hacia atrás ni a uno mismo', () => {
    expect(canChallengePosition(17, 18, N)).toBe(false);
    expect(canChallengePosition(17, 17, N)).toBe(false);
  });

  it('el #1 no puede desafiar a nadie', () => {
    const alcanzables = [];
    for (let p = 1; p <= N; p++)
      if (canChallengePosition(1, p, N)) alcanzables.push(p);
    expect(alcanzables).toEqual([]);
  });

  it('se puede desafiar cruzando el borde de categoría', () => {
    // El #15 abre la categoría B y su fila de arriba es el final de la A.
    expect(canChallengePosition(15, 14, N)).toBe(true);
    expect(canChallengePosition(15, 11, N)).toBe(true);
    expect(canChallengePosition(15, 10, N)).toBe(false);
  });

  it('todos menos el #1 tienen al menos un rival posible', () => {
    for (let yo = 2; yo <= N; yo++) {
      const alcanzables = [];
      for (let p = 1; p <= N; p++)
        if (canChallengePosition(yo, p, N)) alcanzables.push(p);
      expect(alcanzables.length).toBeGreaterThan(0);
    }
  });

  it('la escalerilla puede crecer sin tocar el código', () => {
    expect(ladderRows(60).flat()).toHaveLength(60);
    expect(getLevel(60, 60)).toBeGreaterThan(0);
  });
});
