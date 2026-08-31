/**
 * Geometría de la escalerilla: categorías y niveles.
 *
 * Vivía duplicada en `challenge-rules.service`, `achievements.service` y
 * `master.service`, cada una con su propia copia de los rangos. Acá hay una
 * sola definición, con tests en `ladder.spec.ts`.
 */

// ─────────────────────────── Categorías ───────────────────────────

/**
 * Los rangos de categoría cambiaron entre temporadas, así que el histórico
 * necesita saber con qué esquema se jugó cada una: reetiquetar el 1er semestre
 * 2026 con los rangos nuevos dejaría a los campeones de D archivados en C.
 *
 *  - `legacy4`: 4 categorías sobre 48 puestos, hasta el 1er semestre 2026.
 *  - `v2`: 3 categorías y sin tope, desde el 2do semestre 2026. Se eliminó D.
 */
export type CategoryScheme = 'legacy4' | 'v2';

export const DEFAULT_CATEGORY_SCHEME: CategoryScheme = 'v2';

/** Límite superior de cada categoría. `null` = sin tope (la última). */
const SCHEMES: Record<
  CategoryScheme,
  Array<{ category: string; upTo: number | null }>
> = {
  legacy4: [
    { category: 'A', upTo: 12 },
    { category: 'B', upTo: 24 },
    { category: 'C', upTo: 36 },
    { category: 'D', upTo: 48 },
  ],
  v2: [
    { category: 'A', upTo: 14 },
    { category: 'B', upTo: 28 },
    { category: 'C', upTo: null },
  ],
};

/** Categorías del esquema, de la más alta a la más baja. */
export function categoriesOf(
  scheme: CategoryScheme = DEFAULT_CATEGORY_SCHEME,
): string[] {
  return SCHEMES[scheme].map((c) => c.category);
}

/**
 * Categoría de una posición. `null` para quien está fuera de la escalerilla,
 * para los admins (posición ≥ 1000) y, en `legacy4`, para posiciones sobre 48.
 */
export function categoryOf(
  position: number | null | undefined,
  scheme: CategoryScheme = DEFAULT_CATEGORY_SCHEME,
): string | null {
  if (!position || position < 1 || position >= 1000) return null;
  for (const { category, upTo } of SCHEMES[scheme]) {
    if (upTo === null || position <= upTo) return category;
  }
  return null; // legacy4: fuera de los 48 puestos
}

/** Primera y última posición de una categoría. `to = null` si no tiene tope. */
export function categoryBounds(
  category: string,
  scheme: CategoryScheme = DEFAULT_CATEGORY_SCHEME,
): { from: number; to: number | null } | null {
  const list = SCHEMES[scheme];
  const index = list.findIndex((c) => c.category === category);
  if (index === -1) return null;
  const from = index === 0 ? 1 : (list[index - 1].upTo ?? 0) + 1;
  return { from, to: list[index].upTo };
}

/** La categoría inmediatamente inferior, o `null` si ya es la última. */
export function nextCategoryDown(
  category: string,
  scheme: CategoryScheme = DEFAULT_CATEGORY_SCHEME,
): string | null {
  const list = SCHEMES[scheme];
  const index = list.findIndex((c) => c.category === category);
  if (index === -1 || index === list.length - 1) return null;
  return list[index + 1].category;
}

/** 'A' es la más alta: menor número = mejor categoría. */
export function categoryRank(
  category: string,
  scheme: CategoryScheme = DEFAULT_CATEGORY_SCHEME,
): number {
  return SCHEMES[scheme].findIndex((c) => c.category === category) + 1;
}

// ──────────────────────────── Niveles ─────────────────────────────

/**
 * Niveles de desafío. Un jugador puede desafiar a su mismo nivel (solo a quien
 * esté adelante) o al nivel inmediatamente superior.
 *
 * Los primeros niveles son fijos y cierran justo en los bordes de categoría.
 * Desde el puesto 29 se generan en bloques de 5, así la categoría C puede
 * crecer sin tocar el código.
 */
const FIXED_LEVELS: Array<{ upTo: number }> = [
  { upTo: 1 }, //  N1: #1
  { upTo: 4 }, //  N2: #2-4
  { upTo: 9 }, //  N3: #5-9
  { upTo: 14 }, // N4: #10-14   ← cierra categoría A
  { upTo: 19 }, // N5: #15-19
  { upTo: 24 }, // N6: #20-24
  { upTo: 28 }, // N7: #25-28   ← cierra categoría B
];

/** Primer puesto de la zona de bloques automáticos (categoría C). */
const OPEN_ZONE_FROM = 29;
const OPEN_ZONE_BLOCK = 5;

export function getLevel(position: number | null | undefined): number {
  if (!position || position < 1) return FIXED_LEVELS.length + 1;

  for (let i = 0; i < FIXED_LEVELS.length; i++) {
    if (position <= FIXED_LEVELS[i].upTo) return i + 1;
  }

  // Bloques de 5 desde OPEN_ZONE_FROM, sin tope superior.
  const offset = position - OPEN_ZONE_FROM;
  return FIXED_LEVELS.length + 1 + Math.floor(offset / OPEN_ZONE_BLOCK);
}
