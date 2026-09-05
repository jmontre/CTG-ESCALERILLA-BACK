import {
  nextSeason,
  parseSeasonSlug,
  seasonForDate,
  seasonName,
} from './season-naming';

describe('season-naming', () => {
  it('parsea el slug y arma el nombre', () => {
    expect(parseSeasonSlug('2026-1')).toEqual({
      slug: '2026-1',
      name: 'Escalerilla 2026 · 1er Semestre',
      year: 2026,
      semester: 1,
    });
  });

  it('rechaza slugs que no son AÑO-SEMESTRE', () => {
    expect(parseSeasonSlug('2026')).toBeNull();
    expect(parseSeasonSlug('2026-3')).toBeNull();
    expect(parseSeasonSlug('verano-2026')).toBeNull();
  });

  it('del 1er semestre pasa al 2do del mismo año', () => {
    expect(nextSeason('2026-1')).toMatchObject({
      slug: '2026-2',
      name: 'Escalerilla 2026 · 2do Semestre',
    });
  });

  it('del 2do semestre pasa al 1ro del año siguiente', () => {
    expect(nextSeason('2026-2')).toMatchObject({
      slug: '2027-1',
      name: 'Escalerilla 2027 · 1er Semestre',
    });
  });

  it('con un slug raro cae en la temporada de hoy', () => {
    expect(nextSeason('temporada-vieja', new Date(2027, 8, 5))).toMatchObject({
      slug: '2027-2',
    });
  });

  it('parte el año en dos semestres', () => {
    expect(seasonForDate(new Date(2026, 5, 30)).semester).toBe(1); // 30 jun
    expect(seasonForDate(new Date(2026, 6, 1)).semester).toBe(2); // 1 jul
  });

  it('nombra igual que los datos que ya están en la base', () => {
    expect(seasonName(2026, 1)).toBe('Escalerilla 2026 · 1er Semestre');
    expect(seasonName(2026, 2)).toBe('Escalerilla 2026 · 2do Semestre');
  });
});
