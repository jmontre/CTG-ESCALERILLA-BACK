/**
 * Cómo quedó ordenado un cuadro Master, de campeón a último del round robin.
 *
 * Al cerrar la temporada, los 8 que llegaron al round robin pasan a ocupar los
 * 8 primeros puestos de su categoría en ese orden, y con eso arranca la
 * temporada siguiente. Del 9 hacia abajo la categoría no se toca.
 *
 * Es función pura (no toca la base) porque es la regla que reordena a 46
 * personas: se testea sola, sin levantar Prisma.
 */

export interface MasterOrderMatch {
  round: string;
  status: string;
  player1_id: string;
  player2_id: string;
  winner_id: string | null;
}

export interface MasterOrderGroupPlayer {
  player_id: string;
  wins: number;
  losses: number;
  sets_won: number;
  sets_lost: number;
}

export interface MasterOrderInput {
  matches: MasterOrderMatch[];
  groups: Array<{ players: MasterOrderGroupPlayer[] }>;
}

/** Escalón del cuadro. Menor = mejor; empata dentro del escalón por récord. */
const TIER = {
  CHAMPION: 0,
  FINALIST: 1,
  SEMIFINALIST: 2,
  GROUP_STAGE: 3,
} as const;

/**
 * ¿El cuadro terminó? Sin final jugada no se reordena nada: dejar la
 * escalerilla a medio Master sería peor que no tocarla.
 */
export function isMasterFinished(input: MasterOrderInput): boolean {
  const final = input.matches.find((m) => m.round === 'final');
  return final?.status === 'completed' && !!final.winner_id;
}

/**
 * Orden final de los 8 del round robin: campeón, finalista, los dos
 * semifinalistas perdedores y los cuatro que no pasaron de grupo. Dentro de
 * cada escalón manda el récord del grupo (partidos ganados, luego diferencia
 * de sets, luego sets ganados).
 *
 * Devuelve `[]` si el cuadro no terminó.
 */
export function masterFinalOrder(input: MasterOrderInput): string[] {
  if (!isMasterFinished(input)) return [];

  const tiers = new Map<string, number>();
  const record = new Map<string, MasterOrderGroupPlayer>();

  for (const group of input.groups) {
    for (const gp of group.players) {
      record.set(gp.player_id, gp);
      tiers.set(gp.player_id, TIER.GROUP_STAGE);
    }
  }

  for (const semi of input.matches) {
    if (semi.round !== 'semifinal' || semi.status !== 'completed') continue;
    for (const pid of [semi.player1_id, semi.player2_id]) {
      tiers.set(pid, TIER.SEMIFINALIST);
    }
  }

  const final = input.matches.find((m) => m.round === 'final')!;
  const finalistId =
    final.winner_id === final.player1_id ? final.player2_id : final.player1_id;
  tiers.set(final.winner_id!, TIER.CHAMPION);
  tiers.set(finalistId, TIER.FINALIST);

  // Un finalista podría no estar en ningún grupo si el cuadro se armó a mano;
  // igual entra al orden, sin récord, y queda al final de su escalón.
  for (const pid of [final.winner_id!, finalistId]) {
    if (!tiers.has(pid)) tiers.set(pid, TIER.CHAMPION);
  }

  return [...tiers.keys()].sort((a, b) => {
    const tierDiff = tiers.get(a)! - tiers.get(b)!;
    if (tierDiff !== 0) return tierDiff;
    return compareRecord(record.get(a), record.get(b));
  });
}

/** Mejor récord primero: victorias, diferencia de sets, sets ganados. */
function compareRecord(
  a: MasterOrderGroupPlayer | undefined,
  b: MasterOrderGroupPlayer | undefined,
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.wins !== b.wins) return b.wins - a.wins;
  const diffA = a.sets_won - a.sets_lost;
  const diffB = b.sets_won - b.sets_lost;
  if (diffA !== diffB) return diffB - diffA;
  return b.sets_won - a.sets_won;
}

/**
 * Aplica el orden del Master dentro de un tramo de la escalerilla.
 *
 * `current` son los jugadores del tramo tal como están hoy, ordenados por
 * posición. Los que jugaron el cuadro se van al frente en el orden del Master;
 * el resto los sigue conservando su orden actual.
 *
 * Solo se mueve a quien SIGUE dentro del tramo: si alguien que jugó el Master
 * de B terminó el semestre en C, se lo deja donde está — traerlo de vuelta
 * cambiaría el tamaño de las dos categorías.
 */
export function applyMasterOrderToRange(
  current: string[],
  masterOrder: string[],
): string[] {
  const inRange = new Set(current);
  const promoted = masterOrder.filter((id) => inRange.has(id));
  const promotedSet = new Set(promoted);
  return [...promoted, ...current.filter((id) => !promotedSet.has(id))];
}
