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

// ─────────────────── Filas de la pirámide = niveles ───────────────────

/**
 * Las filas que se dibujan en la escalerilla SON los niveles de desafío.
 *
 * Antes eran dos cosas distintas: una tabla de niveles fija por un lado y un
 * generador de filas por otro. No calzaban, así que la app ofrecía rivales que
 * visualmente estaban dos filas más arriba — el socio veía la pirámide y la
 * zona de desafío contradiciéndose. Una sola definición evita eso.
 *
 * Anchos crecientes, y lo que sobra al final para no dejar una fila de uno o
 * dos sueltos. Se genera en vez de estar escrita a mano porque la última
 * categoría no tiene tope: la escalerilla puede tener 46 jugadores este
 * semestre y 60 el próximo.
 */
export function pyramidRows(from: number, to: number): number[][] {
  if (to < from) return [];
  const positions: number[] = [];
  for (let p = from; p <= to; p++) positions.push(p);

  const rows: number[][] = [];
  // El #1 de la escalerilla va solo, en la cima.
  let width = from === 1 ? 1 : 3;
  let i = 0;
  while (i < positions.length) {
    const remaining = positions.length - i;
    const size = remaining <= width + 2 ? remaining : width;
    rows.push(positions.slice(i, i + size));
    i += size;
    width = Math.min(width + 1, 5);
  }
  return rows;
}

/** Filas de una categoría, acotadas al final real de la escalerilla. */
export function categoryRows(
  category: string,
  ladderSize: number,
  scheme: CategoryScheme = DEFAULT_CATEGORY_SCHEME,
): number[][] {
  const bounds = categoryBounds(category, scheme);
  if (!bounds) return [];
  const last = Math.min(bounds.to ?? ladderSize, ladderSize);
  return pyramidRows(bounds.from, last);
}

/** Todas las filas de la escalerilla, de la cima al fondo. */
export function ladderRows(
  ladderSize: number,
  scheme: CategoryScheme = DEFAULT_CATEGORY_SCHEME,
): number[][] {
  return categoriesOf(scheme).flatMap((c) =>
    categoryRows(c, ladderSize, scheme),
  );
}

/**
 * Nivel de un puesto: el número de la fila en la que cae (1 = la cima).
 *
 * Necesita el tamaño de la escalerilla porque la última categoría no tiene
 * tope, y de eso depende cómo se reparten sus filas.
 */
export function getLevel(
  position: number | null | undefined,
  ladderSize: number,
  scheme: CategoryScheme = DEFAULT_CATEGORY_SCHEME,
): number {
  if (!position || position < 1) return 0;
  const rows = ladderRows(Math.max(ladderSize, position), scheme);
  const index = rows.findIndex((row) => row.includes(position));
  return index === -1 ? 0 : index + 1;
}

/**
 * ¿`target` es un rival válido para quien está en `myPosition`?
 * Misma fila y por delante, o la fila inmediatamente superior.
 */
export function canChallengePosition(
  myPosition: number | null | undefined,
  target: number | null | undefined,
  ladderSize: number,
  scheme: CategoryScheme = DEFAULT_CATEGORY_SCHEME,
): boolean {
  if (!myPosition || !target || target >= myPosition) return false;
  const mine = getLevel(myPosition, ladderSize, scheme);
  const theirs = getLevel(target, ladderSize, scheme);
  if (mine === 0 || theirs === 0) return false;
  return theirs === mine || theirs === mine - 1;
}
