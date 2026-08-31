/**
 * Períodos para mirar el histórico: todo, un año, o una temporada.
 *
 * Vive acá y no dentro de un servicio porque lo usan dos lugares —el historial
 * personal y el fixture del club— y una segunda copia de estos rangos es
 * exactamente el tipo de duplicación que ya causó problemas con las categorías
 * y los niveles.
 */

export interface Period {
  /** "all" · un año ("2026") · el slug de una temporada ("2026-1"). */
  id: string;
  label: string;
  type: 'all' | 'year' | 'season';
  year?: number;
  /** Inclusive. `null` en "todo". */
  from: string | null;
  /** Exclusivo. `null` si el período sigue abierto. */
  to: string | null;
}

interface SeasonLike {
  slug: string;
  name: string;
  started_at: Date;
}

/**
 * Construye la lista de períodos a partir de las temporadas, ordenadas por
 * fecha de inicio ascendente.
 *
 * El rango de una temporada llega hasta que empieza la SIGUIENTE, no hasta su
 * propio `closed_at`: cerrar una y abrir la otra no ocurre en el mismo
 * instante (el 1er semestre 2026 cerró el 31-ago y el 2do abrió el 30), así
 * que usar `closed_at` dejaría partidos contados dos veces o en ninguna.
 */
export function buildPeriods(seasons: SeasonLike[]): Period[] {
  const rangos = seasons.map((s, i) => ({
    slug: s.slug,
    name: s.name,
    year: s.started_at.getUTCFullYear(),
    from: s.started_at,
    to: seasons[i + 1]?.started_at ?? null,
  }));

  const años = [...new Set(rangos.map((r) => r.year))].sort((a, b) => b - a);

  return [
    {
      id: 'all',
      label: 'Todo el historial',
      type: 'all',
      from: null,
      to: null,
    },
    ...años.flatMap((year): Period[] => [
      {
        id: String(year),
        label: String(year),
        type: 'year',
        year,
        from: new Date(Date.UTC(year, 0, 1)).toISOString(),
        to: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
      },
      ...rangos
        .filter((r) => r.year === year)
        .map(
          (r): Period => ({
            id: r.slug,
            // "Escalerilla 2026 · 1er Semestre" → "1er Semestre"
            label: r.name
              .replace(/^Escalerilla\s*/i, '')
              .replace(`${year} · `, ''),
            type: 'season',
            year,
            from: r.from.toISOString(),
            to: r.to ? r.to.toISOString() : null,
          }),
        ),
    ]),
  ];
}

/** El período pedido, o el de "todo" si el id no existe. */
export function findPeriod(periods: Period[], id: string): Period {
  return periods.find((p) => p.id === id) ?? periods[0];
}
