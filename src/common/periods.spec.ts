import { buildPeriods, seasonYear } from './periods';

/**
 * El año de una temporada es el de su slug, no el de su fecha de inicio.
 *
 * El 2do semestre se cierra en diciembre y el 1ro del año siguiente se abre ese
 * mismo día: `2027-1` arranca con `started_at` en 2026. Tomando el año de la
 * fecha, esa temporada quedaba agrupada bajo 2026 y con la etiqueta
 * "2027 · 1er Semestre" (no calzaba el recorte del nombre) — en el filtro del
 * Master, del historial y del fixture.
 */
describe('periods', () => {
  const temporada = (slug: string, name: string, inicio: string) => ({
    slug,
    name,
    started_at: new Date(inicio),
  });

  describe('seasonYear', () => {
    it('toma el año del slug', () => {
      expect(seasonYear(temporada('2027-1', 'x', '2026-12-20T00:00:00Z'))).toBe(2027);
    });

    it('con un slug sin formato AÑO-SEMESTRE cae en el año de inicio', () => {
      expect(seasonYear(temporada('verano', 'x', '2026-12-20T00:00:00Z'))).toBe(2026);
    });
  });

  describe('buildPeriods', () => {
    const periodos = buildPeriods([
      temporada('2026-1', 'Escalerilla 2026 · 1er Semestre', '2026-01-01T00:00:00Z'),
      temporada('2026-2', 'Escalerilla 2026 · 2do Semestre', '2026-08-31T00:00:00Z'),
      // Abierta en diciembre, antes del cambio de año.
      temporada('2027-1', 'Escalerilla 2027 · 1er Semestre', '2026-12-20T00:00:00Z'),
    ]);

    it('agrupa la temporada abierta en diciembre bajo su propio año', () => {
      const t = periodos.find((p) => p.id === '2027-1')!;
      expect(t.year).toBe(2027);
    });

    it('recorta la etiqueta igual que las demás', () => {
      expect(periodos.find((p) => p.id === '2027-1')!.label).toBe('1er Semestre');
      expect(periodos.find((p) => p.id === '2026-2')!.label).toBe('2do Semestre');
    });

    it('lista el año 2027 antes que 2026, con su temporada debajo', () => {
      const ids = periodos.map((p) => p.id);
      expect(ids).toEqual(['all', '2027', '2027-1', '2026', '2026-1', '2026-2']);
    });

    it('el rango de la temporada sigue siendo por fechas reales', () => {
      const t = periodos.find((p) => p.id === '2026-2')!;
      expect(t.from).toBe('2026-08-31T00:00:00.000Z');
      expect(t.to).toBe('2026-12-20T00:00:00.000Z');
    });
  });
});
