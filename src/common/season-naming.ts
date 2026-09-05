/**
 * Nombres y slugs de las temporadas de la escalerilla.
 *
 * El slug es `AÑO-SEMESTRE` ("2026-1", "2026-2") y el nombre se deriva de él.
 * Existe para que abrir la temporada siguiente sea un botón y no un formulario:
 * escribir el slug a mano fue la vía por la que el Master quedó colgado de un
 * nombre que después nadie encontraba.
 */

export interface SeasonNaming {
  slug: string;
  name: string;
  year: number;
  semester: 1 | 2;
}

const SEMESTER_LABEL: Record<1 | 2, string> = {
  1: '1er Semestre',
  2: '2do Semestre',
};

/** Parsea "2026-2". Devuelve `null` si el slug no tiene ese formato. */
export function parseSeasonSlug(slug: string): SeasonNaming | null {
  const match = /^(\d{4})-([12])$/.exec(slug.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const semester = Number(match[2]) as 1 | 2;
  return {
    slug: `${year}-${semester}`,
    name: seasonName(year, semester),
    year,
    semester,
  };
}

export function seasonName(year: number, semester: 1 | 2): string {
  return `Escalerilla ${year} · ${SEMESTER_LABEL[semester]}`;
}

/**
 * La temporada que sigue: el 2do semestre del mismo año, o el 1ro del
 * siguiente. Si el slug actual no es parseable (una temporada creada a mano
 * con otro formato), cae en el semestre que corresponde a `today`.
 */
export function nextSeason(
  currentSlug: string,
  today = new Date(),
): SeasonNaming {
  const current = parseSeasonSlug(currentSlug);
  if (!current) return seasonForDate(today);
  return current.semester === 1
    ? {
        slug: `${current.year}-2`,
        name: seasonName(current.year, 2),
        year: current.year,
        semester: 2,
      }
    : {
        slug: `${current.year + 1}-1`,
        name: seasonName(current.year + 1, 1),
        year: current.year + 1,
        semester: 1,
      };
}

/** La temporada a la que pertenece una fecha (enero-junio = 1er semestre). */
export function seasonForDate(date: Date): SeasonNaming {
  const year = date.getFullYear();
  const semester: 1 | 2 = date.getMonth() < 6 ? 1 : 2;
  return {
    slug: `${year}-${semester}`,
    name: seasonName(year, semester),
    year,
    semester,
  };
}
