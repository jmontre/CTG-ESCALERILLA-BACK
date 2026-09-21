/**
 * Un marcador guardado no dice a quién corresponde el primer número, y en la
 * base conviven dos criterios:
 *
 * - `ResultModal` (el jugador) escribe siempre `desafiante-desafiado`.
 * - El panel de admin tiene un campo libre, y ahí el marcador suele venir
 *   desde el ganador. En producción (sep-2026) eran 10 de 243 partidos con
 *   marcador decisivo: mostrarlos con la convención del desafiante los daba
 *   vuelta, y un partido ganado se leía como perdido.
 *
 * Por eso la orientación se DEDUCE del propio marcador siempre que se pueda:
 * el lado que ganó más sets es el ganador del partido, y de quién ganó ya hay
 * registro aparte (`winner_id`). Cuando el marcador no alcanza para deducirla
 * —retiro, W.O. o sets parejos— se cae a la convención del desafiante, que es
 * la de la enorme mayoría.
 */

/** Invierte cada set: "6-3, 7-6" → "3-6, 6-7". Sufijos y corchetes quedan igual. */
export function flipScore(score: string | null | undefined): string | null {
  if (!score) return null;
  return score.replace(/(\d+)\s*-\s*(\d+)/g, (_m, a: string, b: string) => `${b}-${a}`);
}

/**
 * ¿El lado izquierdo del string es el ganador del partido? `null` cuando el
 * marcador no permite afirmarlo.
 */
function leftSideIsWinner(score: string): boolean | null {
  // Un retiro o un W.O. puede terminar con el ganador abajo en sets.
  if (/retiro|abandono|w\.?o\.?/i.test(score)) return null;

  const sets = [...score.matchAll(/(\d+)\s*-\s*(\d+)/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as const,
  );
  if (sets.length === 0) return null;

  let izquierda = 0;
  let derecha = 0;
  for (const [a, b] of sets) {
    if (a > b) izquierda++;
    else if (b > a) derecha++;
  }
  if (izquierda === derecha) return null;

  return izquierda > derecha;
}

/**
 * Devuelve el marcador desde la perspectiva de un jugador: su propio resultado
 * primero, para que un 6-1 6-0 perdido no se lea como ganado.
 */
export function scoreForPlayer(
  score: string | null | undefined,
  opts: { playerWon: boolean; playerIsChallenger: boolean },
): string | null {
  if (!score) return null;

  const izquierdaEsGanador = leftSideIsWinner(score);

  const izquierdaEsElJugador =
    izquierdaEsGanador === null
      ? opts.playerIsChallenger // sin señal: manda la convención del desafiante
      : izquierdaEsGanador === opts.playerWon;

  return izquierdaEsElJugador ? score : flipScore(score);
}
