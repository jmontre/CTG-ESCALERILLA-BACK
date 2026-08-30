/**
 * Parsing del string de score de un partido, para los logros que dependen de
 * cómo se ganó (rosquilla, remontada, maratonista).
 *
 * Formato producido por ResultModal: sets separados por coma, desde la
 * perspectiva de UNO de los dos jugadores, más sufijos opcionales.
 * Ejemplos reales de la base:
 *   "6-3, 6-1"  ·  "7-6, 4-6, [10-7]"  ·  "W.O."  ·  "6-4, 0-2 (Retiro)"
 *
 * El string NO dice a quién corresponde el primer número. En vez de confiar en
 * el caller, se deduce: el lado que ganó más sets es el ganador del partido.
 * Cuando eso no alcanza (W.O., retiro temprano, sets empatados) se devuelve
 * `perspectiveKnown: false` y quien consuma esto debe abstenerse de otorgar
 * logros que dependan del detalle del marcador.
 */

export interface ParsedScore {
  /** Sets como [propios, del rival] desde la perspectiva del GANADOR. */
  sets: Array<[number, number]>;
  /** false si no se pudo determinar de qué lado leer el marcador. */
  perspectiveKnown: boolean;
  isWalkover: boolean;
  isRetirement: boolean;
  /** El último set fue un super tiebreak (venía entre corchetes). */
  hasSuperTiebreak: boolean;
}

export function parseScore(score: string | null | undefined): ParsedScore {
  const empty: ParsedScore = {
    sets: [],
    perspectiveKnown: false,
    isWalkover: false,
    isRetirement: false,
    hasSuperTiebreak: false,
  };
  if (!score) return empty;

  const isWalkover = /w\.?o\.?/i.test(score);
  const isRetirement = /retiro|abandono/i.test(score);
  if (isWalkover && !/\d/.test(score)) {
    return { ...empty, isWalkover, isRetirement };
  }

  const cleaned = score.replace(/\((?:retiro|abandono)\)/gi, '').trim();
  const raw = cleaned
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let hasSuperTiebreak = false;
  const parsed: Array<[number, number]> = [];
  for (const part of raw) {
    const bracketed = /^\[.*\]$/.test(part);
    const [a, b] = part.replace(/[[\]]/g, '').split('-').map(Number);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    if (bracketed) hasSuperTiebreak = true;
    parsed.push([a, b]);
  }
  if (parsed.length === 0) {
    return { ...empty, isWalkover, isRetirement, hasSuperTiebreak };
  }

  let left = 0;
  let right = 0;
  for (const [a, b] of parsed) {
    if (a > b) left++;
    else if (b > a) right++;
  }

  // Un partido por retiro o W.O. puede terminar con el ganador abajo en sets:
  // ahí el conteo no identifica la perspectiva y no se puede confiar.
  if (left === right || isWalkover || isRetirement) {
    return {
      sets: parsed,
      perspectiveKnown: false,
      isWalkover,
      isRetirement,
      hasSuperTiebreak,
    };
  }

  const winnerIsLeft = left > right;
  return {
    sets: winnerIsLeft
      ? parsed
      : parsed.map(([a, b]) => [b, a] as [number, number]),
    perspectiveKnown: true,
    isWalkover,
    isRetirement,
    hasSuperTiebreak,
  };
}

/** 6-0 6-0: el ganador no cedió un solo game. */
export function isDoubleBagel(parsed: ParsedScore): boolean {
  if (!parsed.perspectiveKnown || parsed.sets.length !== 2) return false;
  return parsed.sets.every(([w, l]) => w === 6 && l === 0);
}

/** El ganador perdió el primer set y dio vuelta el partido. */
export function isComeback(parsed: ParsedScore): boolean {
  if (!parsed.perspectiveKnown || parsed.sets.length < 2) return false;
  const [w, l] = parsed.sets[0];
  return l > w;
}

/** El partido se definió en super tiebreak (tercer set entre corchetes). */
export function isSuperTiebreakWin(parsed: ParsedScore): boolean {
  return parsed.perspectiveKnown && parsed.hasSuperTiebreak;
}
