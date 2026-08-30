import {
  categoryOf,
  categoryBounds,
  nextCategoryDown,
  categoryRank,
  categoriesOf,
  getLevel,
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

describe('niveles', () => {
  it('respeta la tabla fija y cierra en los bordes de categoría', () => {
    expect(getLevel(1)).toBe(1);
    expect(getLevel(2)).toBe(2);
    expect(getLevel(4)).toBe(2);
    expect(getLevel(5)).toBe(3);
    expect(getLevel(9)).toBe(3);
    expect(getLevel(10)).toBe(4);
    expect(getLevel(14)).toBe(4); // fin de categoría A
    expect(getLevel(15)).toBe(5);
    expect(getLevel(19)).toBe(5);
    expect(getLevel(20)).toBe(6);
    expect(getLevel(24)).toBe(6);
    expect(getLevel(25)).toBe(7);
    expect(getLevel(28)).toBe(7); // fin de categoría B
  });

  it('desde el #29 genera bloques de 5 sin tope', () => {
    expect(getLevel(29)).toBe(8);
    expect(getLevel(33)).toBe(8);
    expect(getLevel(34)).toBe(9);
    expect(getLevel(38)).toBe(9);
    expect(getLevel(39)).toBe(10);
    expect(getLevel(43)).toBe(10);
    expect(getLevel(44)).toBe(11);
    expect(getLevel(48)).toBe(11);
    // La escalerilla puede crecer sin tocar el código.
    expect(getLevel(49)).toBe(12);
    expect(getLevel(100)).toBe(22); // (100-29)/5 = 14 bloques sobre el N8
  });

  it('los niveles nunca retroceden al bajar en la escalerilla', () => {
    for (let pos = 1; pos < 200; pos++) {
      expect(getLevel(pos + 1)).toBeGreaterThanOrEqual(getLevel(pos));
    }
  });

  it('un jugador siempre puede desafiar a alguien salvo en el nivel 1', () => {
    // La regla es "mismo nivel adelante, o un nivel arriba": para que sea
    // jugable, cada nivel sobre el 1 debe tener un nivel inmediatamente
    // superior existente.
    for (let pos = 2; pos < 200; pos++) {
      expect(getLevel(pos) - 1).toBeGreaterThanOrEqual(1);
    }
  });
});
