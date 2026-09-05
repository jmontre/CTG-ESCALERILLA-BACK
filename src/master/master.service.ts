import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { categoryBounds } from '../common/ladder';
import { seasonLabel } from '../common/periods';
import { whatsappService } from '../notifications/whatsapp.service';
import { toChileDateStr, chileWeekBoundsFromStr } from '../common/dates';

/**
 * Estructura del cuadro por categoría (desde el 2do semestre 2026):
 *   · puestos 1-4 del rango  → clasifican directo al round robin
 *   · puestos 5-12           → playoff a partido único, salen 4
 *   · puestos 13-14          → eliminados
 * Los 8 resultantes se reparten en Grupo A y Grupo B por paridad de posición.
 */
const MASTER_SLOTS = 14;
const DIRECT_QUALIFIERS = 4;
const PLAYOFF_SLOTS = 8; // puestos 5 al 12
const MIN_PLAYERS = DIRECT_QUALIFIERS + PLAYOFF_SLOTS; // 12

/** Rango de posiciones de la categoría, acotado a los 14 cupos del Master. */
function masterRange(category: string): [number, number] | null {
  const bounds = categoryBounds(category);
  if (!bounds) return null;
  // La última categoría no tiene tope, así que se corta en los 14 cupos.
  return [bounds.from, bounds.to ?? bounds.from + MASTER_SLOTS - 1];
}

// Slots de alta demanda (mantener sincronizado con challenges.service y reservations.service)
const HIGH_DEMAND: Record<string, string[]> = {
  verano: ['07:45', '09:30', '18:15', '20:00'],
  invierno: ['09:30', '11:15', '16:30', '18:15'],
};

// Campos de jugador seguros para los endpoints públicos del Master (findAll /
// findByCategory). NO incluir email, phone ni has_debt. Los métodos que envían
// WhatsApp siguen usando el player completo (necesitan phone).
export const MASTER_PUBLIC_PLAYER_SELECT: Prisma.PlayerSelect = {
  id: true,
  name: true,
  avatar_url: true,
  position: true,
  wins: true,
  losses: true,
  total_matches: true,
  member_type: true,
};

@Injectable()
export class MasterService {
  constructor(private prisma: PrismaService) {}

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Dispara notificaciones sin bloquear la respuesta HTTP. */
  private notifyAsync(task: () => Promise<void>) {
    void task().catch((e) =>
      console.error('⚠️ Error notificaciones (async):', e),
    );
  }

  private async sendWsp(phone: string | null | undefined, message: string) {
    if (!phone) return;
    try {
      await whatsappService.sendMessage(phone, message);
      console.log(`📱 WhatsApp enviado a ${phone}`);
    } catch {
      console.log(`📱 [LOG WSP → ${phone}]\n${message}`);
    }
  }

  private async sendWspGroup(message: string) {
    const groupId = process.env.WHATSAPP_GROUP_ID;
    if (!groupId) {
      console.log(`📱 [LOG GRUPO]\n${message}`);
      return;
    }
    try {
      await whatsappService.sendGroupMessage(groupId, message);
    } catch {
      console.log(`📱 [LOG GRUPO]\n${message}`);
    }
  }

  /**
   * Temporada de escalerilla abierta. El Master siempre se mira "parado" en
   * una temporada: sin esto la página devolvía el cuadro más reciente que
   * existiera, aunque fuera del semestre anterior.
   */
  private async activeSeason() {
    return this.prisma.season.findFirst({
      where: { status: 'active' },
      orderBy: { started_at: 'desc' },
    });
  }

  /**
   * Temporada sobre la que se responde: la pedida por slug, o la abierta.
   * Devuelve `null` si el slug no existe (el llamador responde vacío en vez de
   * caerse: un filtro con un slug viejo no debería romper la página).
   */
  private async resolveSeason(slug?: string) {
    if (!slug || slug === 'active') return this.activeSeason();
    return this.prisma.season.findUnique({ where: { slug } });
  }

  /**
   * Temporadas que se pueden elegir en el filtro del Master: todas las que
   * tienen cuadro, más la abierta aunque todavía no lo tenga (ahí la página
   * muestra el aviso de "aún no disponible" en vez del cuadro del semestre
   * pasado).
   */
  async seasons() {
    const seasons = await this.prisma.season.findMany({
      orderBy: { started_at: 'desc' },
      include: {
        master_seasons: {
          select: { category: true, status: true },
          orderBy: { category: 'asc' },
        },
      },
    });

    return seasons
      .filter((s) => s.master_seasons.length > 0 || s.status === 'active')
      .map((s) => {
        const year = s.started_at.getUTCFullYear();
        return {
          slug: s.slug,
          name: s.name,
          label: seasonLabel(s.name, year),
          year,
          is_active: s.status === 'active',
          category_scheme: s.category_scheme,
          categories: s.master_seasons.map((m) => m.category),
          /** Falso = todavía no se generan los cuadros de esta temporada. */
          has_master: s.master_seasons.length > 0,
          // `every` sobre lista vacía da true: sin cuadros no hay nada
          // completado.
          completed:
            s.master_seasons.length > 0 &&
            s.master_seasons.every((m) => m.status === 'completed'),
        };
      });
  }

  async findAll(seasonSlug?: string) {
    const season = await this.resolveSeason(seasonSlug);
    if (!season) return [];
    return this.prisma.masterSeason.findMany({
      where: { season_id: season.id },
      include: {
        groups: {
          include: {
            players: {
              include: { player: { select: MASTER_PUBLIC_PLAYER_SELECT } },
            },
            matches: {
              include: {
                player1: { select: MASTER_PUBLIC_PLAYER_SELECT },
                player2: { select: MASTER_PUBLIC_PLAYER_SELECT },
                winner: { select: MASTER_PUBLIC_PLAYER_SELECT },
              },
            },
          },
        },
        // Semifinal/final no tienen group_id, así que no aparecen en groups.matches
        matches: {
          where: { round: { in: ['semifinal', 'final'] } },
          include: {
            player1: { select: MASTER_PUBLIC_PLAYER_SELECT },
            player2: { select: MASTER_PUBLIC_PLAYER_SELECT },
            winner: { select: MASTER_PUBLIC_PLAYER_SELECT },
          },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findByCategory(category: string, seasonSlug?: string) {
    const season = await this.resolveSeason(seasonSlug);
    if (!season) return null;
    return this.prisma.masterSeason.findFirst({
      where: { category, season_id: season.id },
      orderBy: { created_at: 'desc' },
      include: {
        groups: {
          include: {
            players: {
              include: { player: { select: MASTER_PUBLIC_PLAYER_SELECT } },
              orderBy: [{ wins: 'desc' }, { sets_won: 'desc' }],
            },
            matches: {
              include: {
                player1: { select: MASTER_PUBLIC_PLAYER_SELECT },
                player2: { select: MASTER_PUBLIC_PLAYER_SELECT },
                winner: { select: MASTER_PUBLIC_PLAYER_SELECT },
              },
              orderBy: { created_at: 'asc' },
            },
          },
        },
        // Semifinal/final no tienen group_id, así que no aparecen en groups.matches
        matches: {
          where: { round: { in: ['semifinal', 'final'] } },
          include: {
            player1: { select: MASTER_PUBLIC_PLAYER_SELECT },
            player2: { select: MASTER_PUBLIC_PLAYER_SELECT },
            winner: { select: MASTER_PUBLIC_PLAYER_SELECT },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    });
  }

  async generateMaster(data: {
    category: string;
    name?: string;
    round_robin_start?: string;
    round_robin_end?: string;
    final_date?: string;
  }) {
    const range = masterRange(data.category);
    if (!range)
      throw new BadRequestException('Categoría inválida. Usa A, B o C.');

    // El cuadro pertenece a la temporada abierta. Sin temporada abierta no hay
    // Master que generar: sería un cuadro huérfano, imposible de filtrar después.
    const ladderSeason = await this.activeSeason();
    if (!ladderSeason)
      throw new BadRequestException(
        'No hay una temporada de escalerilla abierta. Ábrela antes de generar el Master.',
      );

    // El nombre se deriva de la temporada: escribirlo a mano era la vía por la
    // que el cierre no encontraba los cuadros (buscaba por nombre exacto).
    const name = data.name?.trim() || ladderSeason.name;

    const existing = await this.prisma.masterSeason.findFirst({
      where: { category: data.category, season_id: ladderSeason.id },
    });
    if (existing)
      throw new BadRequestException(
        `La Categoría ${data.category} ya tiene su cuadro en ${ladderSeason.name}. ` +
          `Elimínalo antes de volver a generarlo.`,
      );

    const players = await this.prisma.player.findMany({
      where: { position: { gte: range[0], lte: range[1] } },
      orderBy: { position: 'asc' },
      take: MASTER_SLOTS,
    });

    if (players.length < MIN_PLAYERS) {
      throw new BadRequestException(
        `La Categoría ${data.category} tiene solo ${players.length} jugadores. ` +
          `Se necesitan al menos ${MIN_PLAYERS} (4 clasificados directos + 8 de playoff).`,
      );
    }

    // Los que entran al playoff: del 5° al 12° del rango. Del 13° en adelante
    // quedan eliminados sin jugar.
    const playoffPlayers = players.slice(
      DIRECT_QUALIFIERS,
      DIRECT_QUALIFIERS + PLAYOFF_SLOTS,
    );

    const season = await this.prisma.masterSeason.create({
      data: {
        name,
        season_id: ladderSeason.id,
        category: data.category,
        status: 'playoffs',
        round_robin_start: data.round_robin_start
          ? new Date(data.round_robin_start)
          : null,
        round_robin_end: data.round_robin_end
          ? new Date(data.round_robin_end)
          : null,
        final_date: data.final_date ? new Date(data.final_date) : null,
      },
    });

    // Playoff a partido único: se cruzan el mejor con el peor (5°v12°,
    // 6°v11°, 7°v10°, 8°v9°) para que el mejor sembrado tenga el rival más
    // accesible, como en cualquier llave.
    for (let i = 0; i < PLAYOFF_SLOTS / 2; i++) {
      await this.prisma.masterMatch.create({
        data: {
          season_id: season.id,
          round: 'playoff',
          player1_id: playoffPlayers[i].id,
          player2_id: playoffPlayers[PLAYOFF_SLOTS - 1 - i].id,
          status: 'pending',
        },
      });
    }

    const directNames = players
      .slice(0, DIRECT_QUALIFIERS)
      .map((p) => `${p.name} (#${p.position})`)
      .join('\n  • ');
    const eliminated = players.slice(DIRECT_QUALIFIERS + PLAYOFF_SLOTS);

    this.notifyAsync(async () => {
      for (const player of players.slice(0, DIRECT_QUALIFIERS)) {
        await this.sendWsp(
          player.phone,
          `🏆 *Master CTG — Categoría ${data.category}*\n\n` +
            `¡Clasificaste DIRECTO al round robin!\n\n` +
            `Te saltas el playoff. Espera a que se definan los 4 cupos restantes ` +
            `para conocer tu grupo.`,
        );
        await this.sleep(500);
      }
      for (let i = 0; i < PLAYOFF_SLOTS / 2; i++) {
        const p1 = playoffPlayers[i];
        const p2 = playoffPlayers[PLAYOFF_SLOTS - 1 - i];
        for (const [player, rival] of [
          [p1, p2],
          [p2, p1],
        ]) {
          await this.sendWsp(
            player.phone,
            `🏆 *Master CTG — Categoría ${data.category}*\n\n` +
              `Juegas el PLAYOFF por un cupo al round robin.\n\n` +
              `⚔️ Tu rival: *${rival.name}* (#${rival.position})\n\n` +
              `Coordina la fecha e ingresa el resultado en la app.`,
          );
          await this.sleep(500);
        }
      }
      for (const player of eliminated) {
        await this.sendWsp(
          player.phone,
          `🏆 *Master CTG — Categoría ${data.category}*\n\n` +
            `Este semestre quedaste fuera del cuadro por posición (#${player.position}). ` +
            `¡A escalar en la escalerilla para el próximo!`,
        );
        await this.sleep(500);
      }

      const playoffLines = Array.from(
        { length: PLAYOFF_SLOTS / 2 },
        (_, i) =>
          `  • ${playoffPlayers[i].name} vs ${playoffPlayers[PLAYOFF_SLOTS - 1 - i].name}`,
      ).join('\n');

      await this.sendWspGroup(
        `🏆 *Master CTG — Categoría ${data.category} generado*\n\n` +
          `*Clasificados directos:*\n  • ${directNames}\n\n` +
          `*Playoff por los 4 cupos restantes:*\n${playoffLines}\n\n` +
          `📅 Round Robin: ${data.round_robin_start ? new Date(data.round_robin_start).toLocaleDateString('es-CL') : '?'} al ${data.round_robin_end ? new Date(data.round_robin_end).toLocaleDateString('es-CL') : '?'}\n` +
          `🎾 Final: ${data.final_date ? new Date(data.final_date).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }) : '?'}`,
      );
    });

    return this.findByCategory(data.category);
  }

  async scheduleMatch(
    matchId: string,
    userId: string,
    scheduledDate: Date,
    courtId?: string,
  ) {
    const player = await this.prisma.player.findUnique({
      where: { user_id: userId },
      include: { children: true },
    });
    if (!player) throw new BadRequestException('Jugador no encontrado');

    const match = await this.prisma.masterMatch.findUnique({
      where: { id: matchId },
      include: {
        player1: true,
        player2: true,
        season: { select: { category: true } },
      },
    });

    if (!match) throw new NotFoundException('Partido no encontrado');
    if (match.status === 'completed')
      throw new BadRequestException('Este partido ya está completado');
    if (match.player1_id !== player.id && match.player2_id !== player.id) {
      throw new BadRequestException(
        'Solo los jugadores del partido pueden fijar la fecha',
      );
    }
    if (scheduledDate <= new Date())
      throw new BadRequestException('La fecha debe ser en el futuro');

    const setter =
      match.player1_id === player.id ? match.player1 : match.player2;
    const other =
      match.player1_id === player.id ? match.player2 : match.player1;

    // ── Reserva automática (si se eligió cancha) ──────────────────────────────
    if (courtId) {
      const court = await this.prisma.court.findUnique({
        where: { id: courtId },
      });
      if (!court || !court.is_active)
        throw new BadRequestException('Cancha no disponible.');

      const timeStr = scheduledDate.toLocaleTimeString('es-CL', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Santiago',
      });
      const [h, m] = timeStr.split(':');
      const slot = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
      const chileDate = toChileDateStr(scheduledDate);
      const dateChile = new Date(`${chileDate}T00:00:00`);

      // Slot ocupado por otra reserva (que no sea de este partido)
      const slotBusy = await this.prisma.reservation.findFirst({
        where: {
          court_id: courtId,
          date: dateChile,
          time_slot: slot,
          status: 'active',
          NOT: { master_match_id: matchId },
        },
      });
      if (slotBusy)
        throw new BadRequestException(
          'Ese horario ya está ocupado en esa cancha.',
        );

      // Otra reserva activa del jugador (OR explícito por master_match_id nullable)
      const otherActive = await this.prisma.reservation.findFirst({
        where: {
          player_id: player.id,
          status: 'active',
          OR: [
            { master_match_id: null },
            { master_match_id: { not: matchId } },
          ],
        },
      });
      if (otherActive)
        throw new BadRequestException(
          'Ya tienes una reserva activa. Cancélala antes de fijar fecha.',
        );

      // Cupo de alta demanda
      const config = await this.prisma.systemConfig.findUnique({
        where: { key: 'season' },
      });
      const season = config?.value || 'verano';
      const isHighDemand = HIGH_DEMAND[season]?.includes(slot) ?? false;

      if (isHighDemand) {
        const { weekStart, weekEnd } = chileWeekBoundsFromStr(chileDate);
        const playerIds = [
          player.id,
          ...(player.children?.map((c) => c.id) || []),
        ];
        const extraSlots = player.extra_high_demand_slots ?? 0;
        const familyLimit =
          player.member_type === 'hijo_socio'
            ? 1
            : 2 + (player.children?.length || 0) + extraSlots;
        const used = await this.prisma.reservation.count({
          where: {
            player_id: { in: playerIds },
            is_high_demand: true,
            status: 'active',
            date: { gte: weekStart, lte: weekEnd },
            NOT: { master_match_id: matchId },
          },
        });
        if (used >= familyLimit)
          throw new BadRequestException(
            `Ya usaste los ${familyLimit} turnos de alta demanda de esta semana.`,
          );
      }

      // Cancelar reserva anterior de este partido + crear la nueva + fijar fecha, atómico.
      try {
        await this.prisma.$transaction([
          this.prisma.reservation.updateMany({
            where: { master_match_id: matchId, status: 'active' },
            data: {
              status: 'cancelled',
              cancelled_at: new Date(),
              cancel_reason: 'Fecha reprogramada',
            },
          }),
          this.prisma.reservation.create({
            data: {
              player_id: player.id,
              court_id: courtId,
              date: dateChile,
              time_slot: slot,
              is_high_demand: isHighDemand,
              has_guest: false,
              partner_name: other.name,
              is_master: true,
              master_match_id: matchId,
              status: 'active',
            },
          }),
          this.prisma.masterMatch.update({
            where: { id: matchId },
            data: { scheduled_date: scheduledDate },
          }),
        ]);
      } catch (e: any) {
        if (e?.code === 'P2002')
          throw new BadRequestException(
            'Ese horario ya está ocupado en esa cancha.',
          );
        throw e;
      }
    } else {
      await this.prisma.masterMatch.update({
        where: { id: matchId },
        data: { scheduled_date: scheduledDate },
      });
    }

    // ── Notificaciones (fire-and-forget) ──────────────────────────────────────
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const weekday = scheduledDate.toLocaleDateString('es-CL', {
      weekday: 'long',
      timeZone: 'America/Santiago',
    });
    const day = scheduledDate.toLocaleDateString('es-CL', {
      day: 'numeric',
      month: 'long',
      timeZone: 'America/Santiago',
    });
    const hour = scheduledDate.toLocaleTimeString('es-CL', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Santiago',
    });
    const formattedDate = `${cap(weekday)} ${day} — ${hour} hrs`;

    let courtName = '';
    if (courtId) {
      const court = await this.prisma.court.findUnique({
        where: { id: courtId },
      });
      if (court) courtName = ` · ${court.name}`;
    }

    this.notifyAsync(async () => {
      await this.sendWsp(
        other.phone,
        `🏆 *Master CTG*\n\n📅 *${setter.name}* agendó el partido:\n\n*${formattedDate}*${courtName}\n\nSi no puedes, coordina con tu rival.`,
      );
      await this.sleep(500);
      await this.sendWspGroup(
        `🏆 *Master CTG — Categoría ${match.season.category}*\n\n⚔️ *${match.player1.name}* vs *${match.player2.name}*\n📅 ${formattedDate}${courtName}`,
      );
    });

    return this.prisma.masterMatch.findUnique({
      where: { id: matchId },
      include: {
        player1: { select: MASTER_PUBLIC_PLAYER_SELECT },
        player2: { select: MASTER_PUBLIC_PLAYER_SELECT },
        winner: { select: MASTER_PUBLIC_PLAYER_SELECT },
      },
    });
  }

  /**
   * Ingresar resultado — doble confirmación igual que desafíos
   */
  async submitPlayerResult(
    matchId: string,
    userId: string,
    result: { winnerId: string; score: string },
  ) {
    const player = await this.prisma.player.findUnique({
      where: { user_id: userId },
    });
    if (!player) throw new BadRequestException('Jugador no encontrado');

    const match = await this.prisma.masterMatch.findUnique({
      where: { id: matchId },
      include: { player1: true, player2: true },
    });

    if (!match) throw new NotFoundException('Partido no encontrado');
    if (match.status === 'completed')
      throw new BadRequestException('Este partido ya tiene resultado');
    if (match.player1_id !== player.id && match.player2_id !== player.id) {
      throw new BadRequestException(
        'Solo los jugadores del partido pueden ingresar resultado',
      );
    }
    if (
      result.winnerId !== match.player1_id &&
      result.winnerId !== match.player2_id
    ) {
      throw new BadRequestException(
        'El ganador debe ser uno de los jugadores del partido',
      );
    }

    const isPlayer1 = player.id === match.player1_id;

    // Guardar resultado del jugador actual
    const updateData = isPlayer1
      ? { player1_result: result }
      : { player2_result: result };

    await this.prisma.masterMatch.update({
      where: { id: matchId },
      data: updateData,
    });

    // Obtener estado actualizado
    const updated = await this.prisma.masterMatch.findUnique({
      where: { id: matchId },
      include: { player1: true, player2: true },
    });
    if (!updated) throw new NotFoundException('Partido no encontrado');

    const hasP1 = updated.player1_result !== null;
    const hasP2 = updated.player2_result !== null;

    // Solo uno ingresó — notificar al otro
    if (!hasP1 || !hasP2) {
      const other = isPlayer1 ? match.player2 : match.player1;
      const currentName = isPlayer1 ? match.player1.name : match.player2.name;
      this.notifyAsync(async () => {
        await this.sendWsp(
          other.phone,
          `🏆 *Master CTG*\n\n${currentName} ya ingresó el resultado del partido.\n\n¡No olvides ingresar tu resultado también!`,
        );
      });
      return {
        message:
          'Resultado registrado. Esperando confirmación del otro jugador.',
      };
    }

    // Ambos ingresaron — comparar
    const r1 = updated.player1_result as { winnerId: string; score: string };
    const r2 = updated.player2_result as { winnerId: string; score: string };

    if (r1.winnerId === r2.winnerId) {
      // Resultados coinciden → procesar
      return this.processMasterResult(matchId, r1.winnerId, r1.score);
    } else {
      // Disputa
      await this.prisma.masterMatch.update({
        where: { id: matchId },
        data: { status: 'disputed' },
      });

      const message =
        `🏆 *Master CTG*\n\n⚠️ Los resultados ingresados no coinciden.\n\nUn administrador revisará el caso.\n\n` +
        `${match.player1.name} dice: ${r1.score}\n${match.player2.name} dice: ${r2.score}`;

      this.notifyAsync(async () => {
        await this.sendWsp(match.player1.phone, message);
        await this.sleep(600);
        await this.sendWsp(match.player2.phone, message);
      });

      return {
        message:
          'Los resultados no coinciden. Un administrador debe revisar el caso.',
        status: 'disputed',
      };
    }
  }

  /**
   * Procesar resultado confirmado (doble confirmación o admin)
   */
  private async processMasterResult(
    matchId: string,
    winnerId: string,
    score: string,
  ) {
    const match = await this.prisma.masterMatch.findUnique({
      where: { id: matchId },
      include: { player1: true, player2: true },
    });
    if (!match) throw new NotFoundException('Partido no encontrado');

    const loserId =
      winnerId === match.player1_id ? match.player2_id : match.player1_id;
    const winner =
      winnerId === match.player1_id ? match.player1 : match.player2;
    const loser = winnerId === match.player1_id ? match.player2 : match.player1;

    const { setsWinner, setsLoser } = this.parseSets(
      score,
      winnerId === match.player1_id,
    );

    await this.prisma.masterMatch.update({
      where: { id: matchId },
      data: {
        winner_id: winnerId,
        score,
        status: 'completed',
        played_at: new Date(),
      },
    });

    // Liberar la reserva del partido (igual que el desafío)
    await this.prisma.reservation.updateMany({
      where: { master_match_id: matchId, status: 'active' },
      data: {
        status: 'cancelled',
        cancelled_at: new Date(),
        cancel_reason: 'Partido completado',
      },
    });

    if (match.group_id && match.round === 'group') {
      await this.prisma.masterGroupPlayer.updateMany({
        where: { group_id: match.group_id, player_id: winnerId },
        data: {
          wins: { increment: 1 },
          sets_won: { increment: setsWinner },
          sets_lost: { increment: setsLoser },
        },
      });
      await this.prisma.masterGroupPlayer.updateMany({
        where: { group_id: match.group_id, player_id: loserId },
        data: {
          losses: { increment: 1 },
          sets_won: { increment: setsLoser },
          sets_lost: { increment: setsWinner },
        },
      });
      await this.checkAndGenerateSemifinals(match.season_id);
    }

    if (match.round === 'playoff') {
      await this.checkAndGenerateGroups(match.season_id);
    }

    if (match.round === 'semifinal') {
      await this.checkAndGenerateFinal(match.season_id);
    }

    // La final cierra la temporada. Antes quedaba colgada en estado 'final'.
    if (match.round === 'final') {
      await this.prisma.masterSeason.update({
        where: { id: match.season_id },
        data: { status: 'completed' },
      });
    }

    // Notificar jugadores (fire-and-forget)
    const isRetirement = score?.includes('Retiro') || score === 'W.O.';
    const seasonId = match.season_id;
    this.notifyAsync(async () => {
      await this.sendWsp(
        winner.phone,
        `🏆 *Master CTG*\n\n🥇 ¡Ganaste el partido!\n` +
          `${winner.name} vs ${loser.name}\nScore: ${score}` +
          (isRetirement ? '\n_(Retiro/Lesión)_' : ''),
      );
      await this.sleep(600);
      await this.sendWsp(
        loser.phone,
        `🏆 *Master CTG*\n\nResultado confirmado\n` +
          `${winner.name} vs ${loser.name}\nScore: ${score}` +
          (isRetirement ? '\n_(Retiro/Lesión)_' : ''),
      );
      await this.sendWspGroup(
        `🏆 *Master CTG — Resultado Categoría ${(await this.prisma.masterSeason.findUnique({ where: { id: seasonId } }))?.category}*\n\n` +
          `🥇 *${winner.name}* venció a *${loser.name}*\n` +
          `📊 Score: *${score}*` +
          (isRetirement ? '\n_(Partido finalizado por retiro/lesión)_' : ''),
      );
    });

    return {
      message: 'Resultado confirmado.',
      winner: winner.name,
      score,
    };
  }

  /**
   * Ingresar resultado directo (admin)
   */
  async submitResult(matchId: string, winnerId: string, score: string) {
    const match = await this.prisma.masterMatch.findUnique({
      where: { id: matchId },
      include: { player1: true, player2: true },
    });
    if (!match) throw new NotFoundException('Partido no encontrado');
    if (match.status === 'completed')
      throw new BadRequestException('Este partido ya tiene resultado');
    if (winnerId !== match.player1_id && winnerId !== match.player2_id) {
      throw new BadRequestException(
        'El ganador no corresponde a un jugador de este partido',
      );
    }
    return this.processMasterResult(matchId, winnerId, score);
  }

  /**
   * Cierra el playoff y arma el round robin: los 4 clasificados directos más
   * los 4 ganadores del playoff se reparten en Grupo A y Grupo B por paridad
   * de posición en la escalerilla (1°,3°,5°,7° al A; 2°,4°,6°,8° al B).
   *
   * Se dispara al completarse cada partido de playoff y no hace nada hasta que
   * están los cuatro, así que es seguro llamarla de más.
   */
  private async checkAndGenerateGroups(seasonId: string) {
    const season = await this.prisma.masterSeason.findUnique({
      where: { id: seasonId },
    });
    if (!season || season.status !== 'playoffs') return;

    const playoffs = await this.prisma.masterMatch.findMany({
      where: { season_id: seasonId, round: 'playoff' },
      include: { winner: true },
    });
    if (
      playoffs.length === 0 ||
      !playoffs.every((m) => m.status === 'completed' && m.winner_id)
    ) {
      return;
    }

    const existingGroup = await this.prisma.masterGroup.findFirst({
      where: { season_id: seasonId },
    });
    if (existingGroup) return;

    const range = masterRange(season.category);
    if (!range) return;

    const direct = await this.prisma.player.findMany({
      where: { position: { gte: range[0], lte: range[1] } },
      orderBy: { position: 'asc' },
      take: DIRECT_QUALIFIERS,
    });
    const winners = playoffs
      .map((m) => m.winner)
      .filter((w): w is NonNullable<typeof w> => !!w);

    // Los 8 ordenados por su puesto en la escalerilla, y repartidos por paridad.
    const qualified = [...direct, ...winners].sort(
      (a, b) => (a.position ?? 9999) - (b.position ?? 9999),
    );
    const grupoA = qualified.filter((_, i) => i % 2 === 0);
    const grupoB = qualified.filter((_, i) => i % 2 === 1);

    const groups = [
      { name: 'Grupo A', players: grupoA },
      { name: 'Grupo B', players: grupoB },
    ];

    for (const { name: groupName, players: groupPlayers } of groups) {
      const group = await this.prisma.masterGroup.create({
        data: { season_id: seasonId, name: groupName },
      });
      for (const player of groupPlayers) {
        await this.prisma.masterGroupPlayer.create({
          data: { group_id: group.id, player_id: player.id },
        });
      }
      for (let i = 0; i < groupPlayers.length; i++) {
        for (let j = i + 1; j < groupPlayers.length; j++) {
          await this.prisma.masterMatch.create({
            data: {
              group_id: group.id,
              season_id: seasonId,
              round: 'group',
              player1_id: groupPlayers[i].id,
              player2_id: groupPlayers[j].id,
              status: 'pending',
            },
          });
        }
      }
    }

    await this.prisma.masterSeason.update({
      where: { id: seasonId },
      data: { status: 'active' },
    });

    const grupoANames = grupoA.map((p) => p.name).join('\n  • ');
    const grupoBNames = grupoB.map((p) => p.name).join('\n  • ');
    this.notifyAsync(async () => {
      for (const { name: groupName, players: groupPlayers } of groups) {
        for (const player of groupPlayers) {
          await this.sendWsp(
            player.phone,
            `🏆 *Master CTG — Categoría ${season.category}*\n\n` +
              `¡Arranca el round robin!\n\n` +
              `📋 *${groupName}*\n` +
              `Tus rivales: ${groupPlayers
                .filter((p) => p.id !== player.id)
                .map((p) => p.name)
                .join(', ')}\n\n` +
              `Coordina tus partidos e ingresa los resultados en la app.`,
          );
          await this.sleep(500);
        }
      }
      await this.sendWspGroup(
        `🏆 *Master CTG — Categoría ${season.category}: grupos definidos*\n\n` +
          `*Grupo A:*\n  • ${grupoANames}\n\n` +
          `*Grupo B:*\n  • ${grupoBNames}`,
      );
    });
  }

  private async checkAndGenerateSemifinals(seasonId: string) {
    const season = await this.prisma.masterSeason.findUnique({
      where: { id: seasonId },
      include: {
        groups: {
          include: {
            matches: true,
            players: { orderBy: [{ wins: 'desc' }, { sets_won: 'desc' }] },
          },
        },
      },
    });

    if (!season || season.status !== 'active') return;

    const allGroupMatches = season.groups.flatMap((g) =>
      g.matches.filter((m) => m.round === 'group'),
    );
    if (!allGroupMatches.every((m) => m.status === 'completed')) return;

    const existingSemis = await this.prisma.masterMatch.findFirst({
      where: { season_id: seasonId, round: 'semifinal' },
    });
    if (existingSemis) return;

    const [groupA, groupB] = season.groups;
    const top2A = groupA.players.slice(0, 2);
    const top2B = groupB.players.slice(0, 2);

    await this.prisma.masterMatch.createMany({
      data: [
        {
          season_id: seasonId,
          round: 'semifinal',
          player1_id: top2A[0].player_id,
          player2_id: top2B[1].player_id,
          status: 'pending',
        },
        {
          season_id: seasonId,
          round: 'semifinal',
          player1_id: top2B[0].player_id,
          player2_id: top2A[1].player_id,
          status: 'pending',
        },
      ],
    });

    await this.prisma.masterSeason.update({
      where: { id: seasonId },
      data: { status: 'semifinals' },
    });

    const semis = await this.prisma.masterMatch.findMany({
      where: { season_id: seasonId, round: 'semifinal' },
      include: { player1: true, player2: true },
    });
    this.notifyAsync(async () => {
      for (const semi of semis) {
        await this.sendWsp(
          semi.player1.phone,
          `🏆 *Master CTG*\n\n🏅 ¡Clasificaste a Semifinales!\nTu rival: *${semi.player2.name}*\nCoordiña la fecha e ingresa el resultado en la app.`,
        );
        await this.sleep(500);
        await this.sendWsp(
          semi.player2.phone,
          `🏆 *Master CTG*\n\n🏅 ¡Clasificaste a Semifinales!\nTu rival: *${semi.player1.name}*\nCoordiña la fecha e ingresa el resultado en la app.`,
        );
        await this.sleep(500);
      }
      await this.sendWspGroup(
        `🏆 *Master CTG — ¡Semifinales!*\n\n` +
          semis
            .map(
              (s, i) =>
                `🏅 Semi ${i + 1}: *${s.player1.name}* vs *${s.player2.name}*`,
            )
            .join('\n'),
      );
    });
  }

  async checkAndGenerateFinal(seasonId: string) {
    const semis = await this.prisma.masterMatch.findMany({
      where: { season_id: seasonId, round: 'semifinal' },
      include: { player1: true, player2: true, winner: true },
    });

    if (semis.length < 2 || !semis.every((s) => s.status === 'completed'))
      return;

    const existingFinal = await this.prisma.masterMatch.findFirst({
      where: { season_id: seasonId, round: 'final' },
    });
    if (existingFinal) return;

    const finalist1Id = semis[0].winner_id;
    const finalist2Id = semis[1].winner_id;
    const finalist1 = semis[0].winner;
    const finalist2 = semis[1].winner;
    const season = await this.prisma.masterSeason.findUnique({
      where: { id: seasonId },
    });

    await this.prisma.masterMatch.create({
      data: {
        season_id: seasonId,
        round: 'final',
        player1_id: finalist1Id,
        player2_id: finalist2Id,
        status: 'pending',
      },
    });
    await this.prisma.masterSeason.update({
      where: { id: seasonId },
      data: { status: 'final' },
    });

    const finalDateStr = season?.final_date
      ? new Date(season.final_date).toLocaleDateString('es-CL', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })
      : 'Por confirmar';

    this.notifyAsync(async () => {
      await this.sendWsp(
        finalist1.phone,
        `🏆 *Master CTG*\n\n🥇 ¡Estás en la FINAL!\nRival: *${finalist2.name}*\n📅 ${finalDateStr}`,
      );
      await this.sleep(500);
      await this.sendWsp(
        finalist2.phone,
        `🏆 *Master CTG*\n\n🥇 ¡Estás en la FINAL!\nRival: *${finalist1.name}*\n📅 ${finalDateStr}`,
      );
      await this.sendWspGroup(
        `🏆 *Master CTG — ¡GRAN FINAL!*\n\n⚔️ *${finalist1.name}* vs *${finalist2.name}*\n📅 ${finalDateStr}`,
      );
    });
  }

  async deleteSeason(seasonId: string) {
    const matches = await this.prisma.masterMatch.findMany({
      where: { season_id: seasonId },
      select: { id: true },
    });
    const matchIds = matches.map((m) => m.id);
    if (matchIds.length) {
      await this.prisma.reservation.updateMany({
        where: { master_match_id: { in: matchIds }, status: 'active' },
        data: {
          status: 'cancelled',
          cancelled_at: new Date(),
          cancel_reason: 'Torneo eliminado',
        },
      });
    }
    await this.prisma.masterMatch.deleteMany({
      where: { season_id: seasonId },
    });
    const groups = await this.prisma.masterGroup.findMany({
      where: { season_id: seasonId },
    });
    for (const group of groups) {
      await this.prisma.masterGroupPlayer.deleteMany({
        where: { group_id: group.id },
      });
    }
    await this.prisma.masterGroup.deleteMany({
      where: { season_id: seasonId },
    });
    await this.prisma.masterSeason.delete({ where: { id: seasonId } });
    return { message: 'Torneo eliminado' };
  }

  private parseSets(
    score: string,
    player1Wins: boolean,
  ): { setsWinner: number; setsLoser: number } {
    if (!score || score === 'W.O.') return { setsWinner: 0, setsLoser: 0 };
    try {
      const sets = score
        .replace(/\(Retiro\)/i, '')
        .trim()
        .split(',')
        .map((s) => s.trim());
      let setsP1 = 0,
        setsP2 = 0;
      for (const set of sets) {
        const clean = set.replace(/[\[\]]/g, '');
        const [a, b] = clean.split('-').map(Number);
        if (!isNaN(a) && !isNaN(b)) {
          if (a > b) setsP1++;
          else if (b > a) setsP2++;
        }
      }
      return player1Wins
        ? { setsWinner: setsP1, setsLoser: setsP2 }
        : { setsWinner: setsP2, setsLoser: setsP1 };
    } catch {
      return { setsWinner: 0, setsLoser: 0 };
    }
  }
}
