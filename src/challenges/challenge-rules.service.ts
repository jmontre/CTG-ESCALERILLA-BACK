import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Player } from '@prisma/client';
import { add } from 'date-fns';
import {
  getLevel,
  canChallengePosition,
  categoryOf,
  categoryBounds,
  nextCategoryDown,
} from '../common/ladder';

/** Partidos jugados de verdad que se exigen para que otro W.O. cuente. */
const MATCHES_TO_REVALIDATE_WO = 3;

/** No-respuestas antes del primer castigo de categoría. */
const NO_RESPONSES_BEFORE_DEMOTION = 2;

@Injectable()
export class ChallengeRulesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Último puesto ocupado de la escalerilla. Los niveles son las filas de la
   * pirámide, y el reparto de las filas de la última categoría depende de
   * cuántos jugadores hay (no tiene tope).
   */
  async ladderSize(): Promise<number> {
    const last = await this.prisma.player.findFirst({
      where: { position: { gte: 1, lt: 1000 } },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last?.position ?? 0;
  }

  /**
   * HELPER: nivel (fila de la pirámide) según posición. Delega en
   * common/ladder.ts, que es la definición única compartida con el frontend.
   */
  getLevel(position: number, ladderSize: number): number {
    return getLevel(position, ladderSize);
  }

  /**
   * REGLA 1: Puede desafiar mismo nivel (si está adelante) O 1 nivel arriba
   */
  private validateLevel(
    challenger: Player,
    challenged: Player,
    ladderSize: number,
  ): void {
    if (
      canChallengePosition(challenger.position, challenged.position, ladderSize)
    )
      return;

    const mine = this.getLevel(challenger.position!, ladderSize);
    const theirs = this.getLevel(challenged.position!, ladderSize);

    // Mismo nivel pero el desafiado está detrás.
    if (mine === theirs) {
      throw new BadRequestException(
        `No puedes desafiar a ${challenged.name}. En tu misma fila solo puedes desafiar a quien esté por delante tuyo.`,
      );
    }
    throw new BadRequestException(
      `Solo puedes desafiar a jugadores de tu fila o de la fila inmediatamente superior. ` +
        `Tú estás en la fila ${mine} y ${challenged.name} en la ${theirs}.`,
    );
  }

  /**
   * REGLA 2: Verificar que un jugador NO esté "ocupado"
   * (tiene desafío pendiente como challenger O challenged)
   */
  private async validateNotOccupied(
    playerId: string,
    playerName: string,
  ): Promise<void> {
    const occupiedChallenge = await this.prisma.challenge.findFirst({
      where: {
        OR: [{ challenger_id: playerId }, { challenged_id: playerId }],
        status: { in: ['pending', 'accepted'] },
      },
      include: {
        challenger: true,
        challenged: true,
      },
    });

    if (occupiedChallenge) {
      const otherPlayer =
        occupiedChallenge.challenger_id === playerId
          ? occupiedChallenge.challenged.name
          : occupiedChallenge.challenger.name;

      throw new BadRequestException(
        `${playerName} ya tiene un desafío pendiente con ${otherPlayer}`,
      );
    }
  }

  /**
   * REGLA 4: Verificar inmunidad (solo para RECIBIR desafíos)
   */
  private validateImmunity(challenged: Player): void {
    if (challenged.immune_until && challenged.immune_until > new Date()) {
      const hoursLeft = Math.ceil(
        (challenged.immune_until.getTime() - Date.now()) / (1000 * 60 * 60),
      );

      throw new BadRequestException(
        `${challenged.name} tiene inmunidad por ${hoursLeft} hora(s) más`,
      );
    }
  }

  /**
   * VALIDACIÓN COMPLETA antes de crear desafío
   */
  async validateChallenge(
    challengerId: string,
    challengedId: string,
  ): Promise<{ challenger: Player; challenged: Player }> {
    // Obtener jugadores
    const [challenger, challenged] = await Promise.all([
      this.prisma.player.findUnique({ where: { id: challengerId } }),
      this.prisma.player.findUnique({ where: { id: challengedId } }),
    ]);

    if (!challenger || !challenged) {
      throw new BadRequestException('Jugador no encontrado');
    }

    // No puede desafiarse a sí mismo
    if (challengerId === challengedId) {
      throw new BadRequestException('No puedes desafiarte a ti mismo');
    }

    // NUEVA REGLA: Verificar vulnerabilidad del challenger
    this.validateNotVulnerable(challenger);

    // REGLA 1: Verificar niveles (= filas de la pirámide)
    this.validateLevel(challenger, challenged, await this.ladderSize());

    // REGLA 2: Verificar que ninguno esté ocupado
    await this.validateNotOccupied(challengerId, challenger.name);
    await this.validateNotOccupied(challengedId, challenged.name);

    // REGLA 4: Verificar inmunidad del desafiado
    this.validateImmunity(challenged);

    return { challenger, challenged };
  }

  /**
   * Obtener jugadores que un jugador puede desafiar
   */
  async getAvailableChallenges(playerId: string): Promise<Player[]> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      throw new BadRequestException('Jugador no encontrado');
    }

    // Verificar que el jugador no esté ocupado
    const isOccupied = await this.prisma.challenge.findFirst({
      where: {
        OR: [{ challenger_id: playerId }, { challenged_id: playerId }],
        status: { in: ['pending', 'accepted'] },
      },
    });

    if (isOccupied) {
      return []; // No puede desafiar a nadie si está ocupado
    }

    const size = await this.ladderSize();

    // Misma regla que valida la creación del desafío y que dibuja la zona de
    // desafío en el frontend: tu fila (hacia adelante) o la fila de arriba.
    // Antes acá solo salía la fila superior, así que la lista del backend y la
    // que ve el socio no coincidían.
    const candidates = await this.prisma.player.findMany({
      where: { position: { gte: 1, lt: 1000 } },
      orderBy: { position: 'asc' },
    });

    const availablePlayers: Player[] = [];
    for (const p of candidates) {
      if (!canChallengePosition(player.position, p.position, size)) continue;

      const occupied = await this.prisma.challenge.findFirst({
        where: {
          OR: [{ challenger_id: p.id }, { challenged_id: p.id }],
          status: { in: ['pending', 'accepted'] },
        },
      });
      const hasImmunity = p.immune_until && p.immune_until > new Date();

      if (!occupied && !hasImmunity) availablePlayers.push(p);
    }

    return availablePlayers;
  }

  /**
   * REGLA 3: Corrimiento en cadena al ganar desafío
   * El ganador sube a la posición del perdedor, todos entre ellos bajan 1
   */
  async processWin(challengeId: string, winnerId: string, loserId: string) {
    const winner = await this.prisma.player.findUnique({
      where: { id: winnerId },
    });
    const loser = await this.prisma.player.findUnique({
      where: { id: loserId },
    });

    if (!winner || !loser) {
      throw new BadRequestException('Jugador no encontrado');
    }

    // Si el ganador ya está adelante del perdedor, no hay cambio de posiciones
    if (winner.position < loser.position) {
      console.log(`ℹ️  ${winner.name} ya estaba adelante, sin cambios`);
      return;
    }

    const targetPosition = loser.position;
    const oldWinnerPosition = winner.position;

    console.log(
      `📍 Moviendo ${winner.name}: ${oldWinnerPosition} → ${targetPosition}`,
    );

    // Obtener todos los jugadores entre las posiciones (inclusive)
    const affectedPlayers = await this.prisma.player.findMany({
      where: {
        position: {
          gte: targetPosition, // Desde la posición del perdedor
          lt: oldWinnerPosition, // Hasta antes de la posición del ganador
        },
      },
      orderBy: { position: 'desc' }, // ← IMPORTANTE: Orden descendente
    });

    console.log(`📍 Jugadores afectados: ${affectedPlayers.length}`);

    // Historial + corrimiento en UNA transacción (orden descendente: el
    // pivot 9999 libera la posición del ganador y cada update entra a un
    // hueco recién liberado).
    await this.prisma.$transaction([
      ...affectedPlayers.map((player) =>
        this.prisma.rankingHistory.create({
          data: {
            player_id: player.id,
            old_position: player.position,
            position: player.position + 1,
            reason: 'challenge_lost',
          },
        }),
      ),
      this.prisma.rankingHistory.create({
        data: {
          player_id: winner.id,
          old_position: oldWinnerPosition,
          position: targetPosition,
          reason: 'challenge_won',
        },
      }),
      this.prisma.player.update({
        where: { id: winner.id },
        data: { position: 9999 },
      }),
      ...affectedPlayers.map((player) =>
        this.prisma.player.update({
          where: { id: player.id },
          data: { position: player.position + 1 },
        }),
      ),
      this.prisma.player.update({
        where: { id: winner.id },
        data: { position: targetPosition },
      }),
    ]);

    console.log(
      `✅ Corrimiento: ${winner.name} (${oldWinnerPosition} → ${targetPosition})`,
    );
  }

  /**
   * REGLA 4: Aplicar inmunidad y vulnerabilidad post-partido
   */
  async applyPostMatchStatus(winnerId: string, loserId: string) {
    const winner = await this.prisma.player.findUnique({
      where: { id: winnerId },
    });
    const loser = await this.prisma.player.findUnique({
      where: { id: loserId },
    });

    if (!winner || !loser) {
      throw new BadRequestException('Jugador no encontrado');
    }

    // Ganador obtiene inmunidad 24 hrs (EXCEPTO si es pos 1)
    if (winner.position !== 1) {
      await this.prisma.player.update({
        where: { id: winnerId },
        data: {
          immune_until: add(new Date(), { hours: 24 }),
        },
      });
      console.log(
        `🛡️  ${winner.name} tiene inmunidad por 24 hrs (pos ${winner.position})`,
      );
    } else {
      console.log(`👑 ${winner.name} es #1 - SIN inmunidad`);
    }

    // Perdedor queda vulnerable 24 hrs
    await this.prisma.player.update({
      where: { id: loserId },
      data: {
        vulnerable_until: add(new Date(), { hours: 24 }),
      },
    });
    console.log(`⚠️  ${loser.name} vulnerable por 24 hrs`);
  }

  /**
   * REGLA 5: Verificar que el challenger NO esté vulnerable
   * (solo puede RECIBIR desafíos, no crear)
   */
  private validateNotVulnerable(challenger: Player): void {
    if (
      challenger.vulnerable_until &&
      challenger.vulnerable_until > new Date()
    ) {
      const hoursLeft = Math.ceil(
        (challenger.vulnerable_until.getTime() - Date.now()) / (1000 * 60 * 60),
      );

      throw new BadRequestException(
        `No puedes desafiar mientras estés vulnerable. Podrás desafiar de nuevo en ${hoursLeft} hora(s).`,
      );
    }
  }

  /**
   * Actualizar estadísticas de ambos jugadores
   */
  async updateStats(winnerId: string, loserId: string) {
    await this.prisma.player.update({
      where: { id: winnerId },
      data: {
        total_matches: { increment: 1 },
        wins: { increment: 1 },
      },
    });

    await this.prisma.player.update({
      where: { id: loserId },
      data: {
        total_matches: { increment: 1 },
        losses: { increment: 1 },
      },
    });

    // Un partido jugado de verdad limpia el historial de ausencias de ambos:
    // el castigo apunta a quien se ausenta seguido, no a quien falló una vez.
    await this.prisma.player.updateMany({
      where: { id: { in: [winnerId, loserId] } },
      data: { no_response_count: 0 },
    });
  }

  // ───────────────── Desaires: rechazo y no-respuesta ─────────────────

  /**
   * Movimiento cuando el desafiado se desaira (rechaza o deja vencer el plazo).
   *
   * El que desaira BAJA al puesto del desafiante y todos los del medio suben
   * uno para tapar el hueco. Ojo: no es lo mismo que ganar un partido — el
   * desafiante sube un solo puesto, no salta al del rival.
   *
   *   #10 desafía al #6 y el #6 desaira:
   *     #6 Beltrán → #10   ·   #7,#8,#9 suben uno   ·   #10 desafiante → #9
   *
   * Todo dentro de una transacción, con pivot a 9999 para no colisionar
   * (las posiciones son únicas por convención, sin constraint que lo imponga).
   */
  async processDecline(
    challengeId: string,
    challengerId: string,
    declinerId: string,
    reason: 'challenge_rejected' | 'challenge_not_answered',
  ): Promise<void> {
    const challenger = await this.prisma.player.findUnique({
      where: { id: challengerId },
    });
    const decliner = await this.prisma.player.findUnique({
      where: { id: declinerId },
    });
    if (!challenger || !decliner) {
      throw new BadRequestException('Jugador no encontrado');
    }
    if (challenger.position == null || decliner.position == null) {
      return; // alguno está fuera de la escalerilla: nada que mover
    }
    // Si el que desaira ya estaba más abajo, no hay nada que corregir.
    if (decliner.position >= challenger.position) return;

    const targetPosition = challenger.position;
    const vacated = decliner.position;

    // Todos los que quedan entre el hueco y el desafiante (ambos incluidos)
    // suben un puesto. Orden ascendente: cada uno entra al hueco que dejó el
    // anterior.
    const shifting = await this.prisma.player.findMany({
      where: { position: { gt: vacated, lte: targetPosition } },
      orderBy: { position: 'asc' },
    });

    await this.prisma.$transaction([
      ...shifting.map((p) =>
        this.prisma.rankingHistory.create({
          data: {
            player_id: p.id,
            old_position: p.position,
            position: p.position! - 1,
            reason,
          },
        }),
      ),
      this.prisma.rankingHistory.create({
        data: {
          player_id: decliner.id,
          old_position: vacated,
          position: targetPosition,
          reason,
        },
      }),
      // Pivot: libera el puesto del que desaira antes de correr al resto.
      this.prisma.player.update({
        where: { id: decliner.id },
        data: { position: 9999 },
      }),
      ...shifting.map((p) =>
        this.prisma.player.update({
          where: { id: p.id },
          data: { position: p.position! - 1 },
        }),
      ),
      this.prisma.player.update({
        where: { id: decliner.id },
        data: { position: targetPosition },
      }),
    ]);

    console.log(
      `📍 ${decliner.name} desairó (${reason}): #${vacated} → #${targetPosition}, ` +
        `${shifting.length} jugador(es) suben uno`,
    );
  }

  /**
   * Castigo por ausencias repetidas. A la 2ª no-respuesta el jugador cae al
   * último puesto de su categoría; de ahí en adelante, cada no-respuesta lo
   * manda al último de la categoría siguiente, hasta el fondo de la escalerilla.
   *
   * Devuelve la posición nueva, o null si todavía no corresponde castigo.
   */
  async applyNoResponsePenalty(
    playerId: string,
    scheme: 'legacy4' | 'v2' = 'v2',
  ): Promise<number | null> {
    const player = await this.prisma.player.update({
      where: { id: playerId },
      data: { no_response_count: { increment: 1 } },
    });
    if (
      player.position == null ||
      player.no_response_count < NO_RESPONSES_BEFORE_DEMOTION
    ) {
      return null;
    }

    // La 2ª no-respuesta cae al fondo de su categoría; cada una siguiente baja
    // una categoría más.
    const extraDrops = player.no_response_count - NO_RESPONSES_BEFORE_DEMOTION;
    let category = categoryOf(player.position, scheme);
    if (!category) return null;
    for (let i = 0; i < extraDrops; i++) {
      const below = nextCategoryDown(category, scheme);
      if (!below) break; // ya está en la última categoría
      category = below;
    }

    const bounds = categoryBounds(category, scheme);
    if (!bounds) return null;

    const lastActive = await this.prisma.player.findFirst({
      where: { position: { gte: 1, lt: 1000 } },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const ladderEnd = lastActive?.position ?? player.position;
    // El fondo de la categoría, sin pasarse del final real de la escalerilla.
    const target = Math.min(bounds.to ?? ladderEnd, ladderEnd);

    if (target <= player.position) return null; // ya estaba igual o más abajo

    await this.dropTo(
      player.id,
      player.position,
      target,
      'no_response_penalty',
    );
    console.log(
      `⬇️  ${player.name}: ${player.no_response_count}ª no-respuesta → ` +
        `último de categoría ${category} (#${target})`,
    );
    return target;
  }

  /**
   * Baja a un jugador hasta `target`, subiendo un puesto a todos los que
   * quedan en el medio. Mismo patrón de pivot que processDecline.
   */
  private async dropTo(
    playerId: string,
    from: number,
    to: number,
    reason: string,
  ): Promise<void> {
    const shifting = await this.prisma.player.findMany({
      where: { position: { gt: from, lte: to } },
      orderBy: { position: 'asc' },
    });

    await this.prisma.$transaction([
      ...shifting.map((p) =>
        this.prisma.rankingHistory.create({
          data: {
            player_id: p.id,
            old_position: p.position,
            position: p.position! - 1,
            reason,
          },
        }),
      ),
      this.prisma.rankingHistory.create({
        data: { player_id: playerId, old_position: from, position: to, reason },
      }),
      this.prisma.player.update({
        where: { id: playerId },
        data: { position: 9999 },
      }),
      ...shifting.map((p) =>
        this.prisma.player.update({
          where: { id: p.id },
          data: { position: p.position! - 1 },
        }),
      ),
      this.prisma.player.update({
        where: { id: playerId },
        data: { position: to },
      }),
    ]);
  }

  // ────────────────────────── Validez del W.O. ──────────────────────────

  /**
   * ¿Le cuenta a este desafiante un W.O.?
   *
   * Después de ganar uno necesita 3 partidos jugados de verdad para que otro
   * valga; si no, nadie escalaría a punta de rivales que no contestan. Cuando
   * no cuenta, el desafío se anula y no se mueve nadie (tampoco se castiga al
   * ausente).
   */
  async canClaimWalkover(challengerId: string): Promise<boolean> {
    const player = await this.prisma.player.findUnique({
      where: { id: challengerId },
      select: { last_wo_win_at: true },
    });
    if (!player?.last_wo_win_at) return true; // nunca ganó por W.O.

    const playedSince = await this.prisma.challenge.count({
      where: {
        status: 'completed',
        winner_id: { not: null },
        played_at: { gt: player.last_wo_win_at },
        OR: [{ challenger_id: challengerId }, { challenged_id: challengerId }],
      },
    });
    return playedSince >= MATCHES_TO_REVALIDATE_WO;
  }

  /** Marca que este jugador acaba de ganar por W.O. (arranca su contador). */
  async recordWalkoverWin(challengerId: string): Promise<void> {
    await this.prisma.player.update({
      where: { id: challengerId },
      data: { last_wo_win_at: new Date() },
    });
  }
}
