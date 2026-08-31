import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChallengeRulesService } from './challenge-rules.service';
import { whatsappService } from '../notifications/whatsapp.service';
import { emailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../achievements/achievements.service';
import { AppLogger } from '../common/app.logger';
import { add } from 'date-fns';
import { toChileDateStr, chileWeekBoundsFromStr } from '../common/dates';

// Campos públicos de un jugador expuestos en respuestas de desafíos a terceros.
// Sin PII (sin email, phone, has_debt).
export const CHALLENGE_PLAYER_SELECT = {
  id: true,
  name: true,
  position: true,
  wins: true,
  losses: true,
  avatar_url: true,
  member_type: true,
} satisfies Prisma.PlayerSelect;

const HIGH_DEMAND: Record<string, string[]> = {
  verano: ['07:45', '09:30', '18:15', '20:00'],
  invierno: ['09:30', '11:15', '16:30', '18:15'],
};

@Injectable()
export class ChallengesService {
  constructor(
    private prisma: PrismaService,
    private rules: ChallengeRulesService,
    private appLogger: AppLogger,
    private notificationsService: NotificationsService,
    private achievements: AchievementsService,
  ) {}

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Resuelve el player_id a partir del userId del JWT. */
  async getPlayerIdFromUserId(userId: string): Promise<string> {
    const player = await this.prisma.player.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!player)
      throw new NotFoundException('Jugador no encontrado para este usuario');
    return player.id;
  }

  /** Dispara notificaciones sin bloquear la respuesta HTTP. */
  private notifyAsync(task: () => Promise<void>) {
    void task().catch((e) =>
      console.error('⚠️ Error notificaciones (async):', e),
    );
  }

  async create(challengerId: string, challengedId: string) {
    const { challenger, challenged } = await this.rules.validateChallenge(
      challengerId,
      challengedId,
    );
    const now = new Date();
    const challenge = await this.prisma.challenge.create({
      data: {
        challenger_id: challengerId,
        challenged_id: challengedId,
        status: 'pending',
        accept_deadline: add(now, { hours: 24 }),
        play_deadline: add(now, { days: 5 }),
      },
      include: {
        challenger: {
          select: { id: true, name: true, position: true, phone: true },
        },
        challenged: {
          select: { id: true, name: true, position: true, phone: true },
        },
      },
    });
    this.notifyAsync(async () => {
      if (challenged.phone) {
        await whatsappService.sendChallengeNotification(
          challenger.name,
          challenged.name,
          challenged.phone,
        );
        await this.sleep(500);
      }
      await emailService.sendChallengeNotification(
        challenger.name,
        challenged.name,
        challenged.email,
      );
      await this.notificationsService.create(challenged.id, {
        type: 'challenge_received',
        title: '¡Tienes un desafío!',
        body: `${challenger.name} te desafió. Tienes 24 horas para responder.`,
        action_label: 'Responder',
        action_path: '/fixture',
      });
    });
    this.appLogger.challengeCreated(
      challenger.name,
      challenged.name,
      challenger.position,
      challenged.position,
    );
    return { message: 'Desafío creado exitosamente', challenge };
  }

  async findAll() {
    return this.prisma.challenge.findMany({
      include: {
        challenger: { select: { id: true, name: true, position: true } },
        challenged: { select: { id: true, name: true, position: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.challenge.findUnique({
      where: { id },
      include: {
        challenger: { select: CHALLENGE_PLAYER_SELECT },
        challenged: { select: CHALLENGE_PLAYER_SELECT },
      },
    });
  }

  async accept(challengeId: string, playerId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        // email incluido solo para la notificación interna (emailService), no va al response.
        challenger: {
          select: { id: true, name: true, email: true, phone: true },
        },
        challenged: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });
    if (!challenge) throw new BadRequestException('Desafío no encontrado');
    if (challenge.challenged_id !== playerId)
      throw new BadRequestException('Solo el desafiado puede aceptar');
    if (challenge.status !== 'pending')
      throw new BadRequestException('Este desafío ya no está pendiente');
    if (new Date() > challenge.accept_deadline)
      throw new BadRequestException('El plazo para aceptar ya expiró');

    // Claim atómico: solo avanza si sigue pending (doble click / colisión con cron)
    const claimed = await this.prisma.challenge.updateMany({
      where: { id: challengeId, status: 'pending' },
      data: { status: 'accepted', accepted_at: new Date() },
    });
    if (claimed.count === 0)
      throw new BadRequestException('Este desafío ya no está pendiente');

    const updated = {
      ...challenge,
      status: 'accepted' as const,
      accepted_at: new Date(),
    };
    this.notifyAsync(async () => {
      if (updated.challenger.phone) {
        await whatsappService.sendAcceptedNotification(
          updated.challenger.name,
          updated.challenged.name,
          updated.challenger.phone,
        );
        await this.sleep(500);
      }
      await emailService.sendAcceptedNotification(
        updated.challenger.name,
        updated.challenged.name,
        updated.challenger.email,
      );
      await this.notificationsService.create(updated.challenger.id, {
        type: 'challenge_accepted',
        title: 'Aceptaron tu desafío',
        body: `${updated.challenged.name} aceptó. Tienen 5 días para jugar el partido.`,
        action_label: 'Fijar fecha',
        action_path: '/fixture',
      });
    });
    this.appLogger.challengeAccepted(
      updated.challenger.name,
      updated.challenged.name,
    );
    // Strippear email antes de devolver: se usó internamente para emailService, no cruza HTTP.
    const { email: _ce, ...challengerSafe } = updated.challenger;
    const { email: _de, ...challengedSafe } = updated.challenged;
    return {
      message: 'Desafío aceptado exitosamente',
      challenge: {
        ...updated,
        challenger: challengerSafe,
        challenged: challengedSafe,
      },
    };
  }

  async reject(challengeId: string, playerId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        challenger: { select: { id: true, name: true, phone: true } },
        challenged: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!challenge) throw new BadRequestException('Desafío no encontrado');
    if (challenge.challenged_id !== playerId)
      throw new BadRequestException('Solo el desafiado puede rechazar');

    // Update atómico: solo avanza si sigue en 'pending'. Previene doble procesamiento
    // ante requests concurrentes (doble click) o colisión con el cron.
    const claimed = await this.prisma.challenge.updateMany({
      where: { id: challengeId, status: 'pending' },
      data: { status: 'rejected', resolved_at: new Date() },
    });
    if (claimed.count === 0)
      throw new BadRequestException('Este desafío ya no está pendiente');

    // Rechazar no es ganar un partido: el que rechaza BAJA al puesto del
    // desafiante y los del medio suben uno. El desafiante sube un solo puesto.
    await this.rules.processDecline(
      challengeId,
      challenge.challenger_id,
      challenge.challenged_id,
      'challenge_rejected',
    );
    await this.rules.applyPostMatchStatus(
      challenge.challenger_id,
      challenge.challenged_id,
    );
    this.appLogger.challengeRejected(
      challenge.challenger.name,
      challenge.challenged.name,
    );

    this.notifyAsync(async () => {
      if (challenge.challenger.phone) {
        await whatsappService.sendMessage(
          challenge.challenger.phone,
          `🎾 *Club de Tenis Graneros*\n\n${challenge.challenged.name} rechazó tu desafío.\n\n📈 Subes un puesto: ${challenge.challenged.name} baja a tu posición anterior.`,
        );
        await this.sleep(500);
      }
      const groupId = process.env.WHATSAPP_GROUP_ID;
      const winner = await this.prisma.player.findUnique({
        where: { id: challenge.challenger_id },
      });
      const loser = await this.prisma.player.findUnique({
        where: { id: challenge.challenged_id },
      });
      if (groupId && winner && loser) {
        await whatsappService.sendGroupMessage(
          groupId,
          `🎾 *Escalerilla CTG — W.O.*\n\n🏆 *${winner.name}* gana por W.O.\n${loser.name} rechazó el desafío.\n\n📈 Nuevas posiciones:\n  • ${winner.name}: #${winner.position}\n  • ${loser.name}: #${loser.position}`,
        );
      }
      await this.notificationsService.create(challenge.challenger.id, {
        type: 'challenge_rejected',
        title: 'Desafío rechazado',
        body: `${challenge.challenged.name} rechazó tu desafío.`,
        action_path: '/fixture',
      });
    });

    return { message: 'Desafío rechazado. El desafiante gana por W.O.' };
  }

  async submitResult(
    challengeId: string,
    submitterId: string,
    result: { winnerId: string; score: string },
  ) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        challenger: { select: { id: true, name: true, phone: true } },
        challenged: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!challenge) throw new BadRequestException('Desafío no encontrado');
    if (challenge.status !== 'accepted')
      throw new BadRequestException(
        'Solo puedes ingresar resultado de desafíos aceptados',
      );

    const isChallenger = submitterId === challenge.challenger_id;
    const isChallenged = submitterId === challenge.challenged_id;
    if (!isChallenger && !isChallenged)
      throw new BadRequestException(
        'Solo los jugadores del desafío pueden ingresar resultado',
      );
    if (
      result.winnerId !== challenge.challenger_id &&
      result.winnerId !== challenge.challenged_id
    )
      throw new BadRequestException('El ganador debe ser uno de los jugadores');

    const isFirstResult =
      !challenge.challenger_result && !challenge.challenged_result;
    await this.prisma.challenge.update({
      where: { id: challengeId },
      data: {
        ...(isChallenger
          ? { challenger_result: result }
          : { challenged_result: result }),
        ...(isFirstResult ? { first_result_at: new Date() } : {}),
      },
    });

    const updated = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        challenger: { select: { id: true, name: true, phone: true } },
        challenged: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!updated) throw new BadRequestException('Error al actualizar desafío');

    if (!updated.challenger_result || !updated.challenged_result) {
      const other = isChallenger ? updated.challenged : updated.challenger;
      const current = isChallenger ? updated.challenger : updated.challenged;
      const submittedResult = isChallenger
        ? updated.challenger_result
        : updated.challenged_result;
      const submittedScore = (submittedResult as { score: string } | null)
        ?.score;
      this.notifyAsync(async () => {
        if (other.phone)
          await whatsappService.sendMessage(
            other.phone,
            `🎾 *Club de Tenis Graneros*\n\n${current.name} ya ingresó el resultado.\n\n¡No olvides ingresar el tuyo también!`,
          );
        await this.notificationsService.create(other.id, {
          type: 'result_submitted',
          title: 'Tu rival ingresó el resultado',
          body: `${current.name} registró el partido ${submittedScore}. Confírmalo o dispútalo.`,
          action_label: 'Confirmar',
          action_path: '/fixture',
        });
      });
    }

    if (updated.challenger_result && updated.challenged_result)
      return this.processDoubleConfirmation(challengeId);
    return {
      message: 'Resultado registrado. Esperando confirmación del otro jugador.',
      challenge: updated,
    };
  }

  /**
   * Fijar fecha + cancha → crea reserva automática descontando cupo de alta demanda
   */
  async scheduleMatch(
    challengeId: string,
    playerId: string,
    scheduledDate: Date,
    courtId?: string,
  ) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        challenger: { select: { id: true, name: true, phone: true } },
        challenged: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!challenge) throw new BadRequestException('Desafío no encontrado');
    if (challenge.status !== 'accepted')
      throw new BadRequestException(
        'Solo puedes fijar fecha en desafíos aceptados',
      );
    if (
      challenge.challenger_id !== playerId &&
      challenge.challenged_id !== playerId
    )
      throw new BadRequestException('Solo los jugadores pueden fijar la fecha');
    if (scheduledDate <= new Date())
      throw new BadRequestException('La fecha debe ser en el futuro');
    if (scheduledDate > challenge.play_deadline)
      throw new BadRequestException(
        'La fecha supera el plazo límite del partido',
      );

    type ScheduledChallenge = Awaited<
      ReturnType<typeof this.prisma.challenge.update>
    > & {
      challenger: { id: string; name: string; phone: string | null };
      challenged: { id: string; name: string; phone: string | null };
    };
    let updated: ScheduledChallenge;

    // ── Reserva automática ────────────────────────────────────────────────────
    if (courtId) {
      const court = await this.prisma.court.findUnique({
        where: { id: courtId },
      });
      if (!court || !court.is_active)
        throw new BadRequestException('Cancha no disponible.');

      const dateOnly = new Date(scheduledDate);
      dateOnly.setHours(0, 0, 0, 0);

      // Extraer hora en zona Chile para evitar desfase UTC
      const timeStr = scheduledDate.toLocaleTimeString('es-CL', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Santiago',
      });
      const [h, m] = timeStr.split(':');
      const slot = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;

      // Fecha en zona Chile
      const chileDate = toChileDateStr(scheduledDate);
      const dateChile = new Date(`${chileDate}T00:00:00`);

      // Slot ocupado por otro partido
      const slotBusy = await this.prisma.reservation.findFirst({
        where: {
          court_id: courtId,
          date: dateChile,
          time_slot: slot,
          status: 'active',
          NOT: { challenge_id: challengeId },
        },
      });
      if (slotBusy)
        throw new BadRequestException(
          'Ese horario ya está ocupado en esa cancha.',
        );

      // Otra reserva activa del jugador (que no sea de este desafío)
      // OR explícito para manejar challenge_id NULL (reservas normales): NOT sobre campo nullable
      // excluye registros con NULL en SQL, por lo que challenge_id=null no sería detectado sin el OR.
      const otherActive = await this.prisma.reservation.findFirst({
        where: {
          player_id: playerId,
          status: 'active',
          OR: [{ challenge_id: null }, { challenge_id: { not: challengeId } }],
        },
      });
      if (otherActive)
        throw new BadRequestException(
          'Ya tienes una reserva activa. Cancélala antes de fijar fecha.',
        );

      // Cupos alta demanda
      const config = await this.prisma.systemConfig.findUnique({
        where: { key: 'season' },
      });
      const season = config?.value || 'verano';
      const isHighDemand = HIGH_DEMAND[season]?.includes(slot) ?? false;

      if (isHighDemand) {
        const player = await this.prisma.player.findUnique({
          where: { id: playerId },
          include: { children: true },
        });
        if (player) {
          const { weekStart, weekEnd } = chileWeekBoundsFromStr(chileDate);

          const playerIds = [
            playerId,
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
              NOT: { challenge_id: challengeId },
            },
          });
          if (used >= familyLimit)
            throw new BadRequestException(
              `Ya usaste los ${familyLimit} turnos de alta demanda de esta semana.`,
            );
        }
      }

      // Nombre del rival para partner_name
      const other =
        challenge.challenger_id === playerId
          ? challenge.challenged
          : challenge.challenger;

      // Cancelar reserva anterior + crear la nueva + fijar la fecha del desafío,
      // todo atómico: o se reprograma completo o no cambia nada.
      try {
        const [, , updatedTx] = await this.prisma.$transaction([
          this.prisma.reservation.updateMany({
            where: { challenge_id: challengeId, status: 'active' },
            data: {
              status: 'cancelled',
              cancelled_at: new Date(),
              cancel_reason: 'Fecha reprogramada',
            },
          }),
          this.prisma.reservation.create({
            data: {
              player_id: playerId,
              court_id: courtId,
              date: dateChile,
              time_slot: slot,
              is_high_demand: isHighDemand,
              has_guest: false,
              partner_name: other.name,
              is_challenge: true,
              challenge_id: challengeId,
              status: 'active',
            },
          }),
          this.prisma.challenge.update({
            where: { id: challengeId },
            data: { scheduled_date: scheduledDate },
            include: {
              challenger: { select: { id: true, name: true, phone: true } },
              challenged: { select: { id: true, name: true, phone: true } },
            },
          }),
        ]);
        updated = updatedTx;
      } catch (e: any) {
        // Índice parcial reservations_active_slot_uniq: carrera perdida
        if (e?.code === 'P2002')
          throw new BadRequestException(
            'Ese horario ya está ocupado en esa cancha.',
          );
        throw e;
      }
    } else {
      // Sin cancha: solo fijar la fecha del desafío.
      updated = await this.prisma.challenge.update({
        where: { id: challengeId },
        data: { scheduled_date: scheduledDate },
        include: {
          challenger: { select: { id: true, name: true, phone: true } },
          challenged: { select: { id: true, name: true, phone: true } },
        },
      });
    }

    const isChallenger = challenge.challenger_id === playerId;
    const setter = isChallenger ? updated.challenger : updated.challenged;
    const other = isChallenger ? updated.challenged : updated.challenger;

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
      if (other.phone) {
        await whatsappService.sendMessage(
          other.phone,
          `🎾 *Club de Tenis Graneros*\n\n📅 *${setter.name}* fijó la fecha del partido:\n\n*${formattedDate}*${courtName}\n\nSi no puedes, coordina con tu rival.`,
        );
        await this.sleep(500);
      }
      const groupId = process.env.WHATSAPP_GROUP_ID;
      if (groupId) {
        await whatsappService.sendGroupMessage(
          groupId,
          `🎾 *Escalerilla CTG — Partido Agendado*\n\n⚔️ *${updated.challenger.name}* vs *${updated.challenged.name}*\n📅 ${formattedDate}${courtName}`,
        );
      }
    });

    this.appLogger.challengeScheduled(
      updated.challenger.name,
      updated.challenged.name,
      formattedDate,
      courtName.replace(' · ', ''),
    );
    return {
      message: 'Fecha del partido fijada correctamente',
      challenge: updated,
    };
  }

  private async processDoubleConfirmation(challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        challenger: {
          select: { id: true, name: true, phone: true, position: true },
        },
        challenged: {
          select: { id: true, name: true, phone: true, position: true },
        },
      },
    });
    if (!challenge) throw new BadRequestException('Desafío no encontrado');

    const result1 = challenge.challenger_result as {
      winnerId: string;
      score: string;
    };
    const result2 = challenge.challenged_result as {
      winnerId: string;
      score: string;
    };

    if (result1.winnerId === result2.winnerId) {
      const winnerId = result1.winnerId;
      const loserId =
        winnerId === challenge.challenger_id
          ? challenge.challenged_id
          : challenge.challenger_id;
      // Posiciones ANTES del corrimiento (processWin) — para detectar si hubo swap.
      const oldWinnerPosition =
        winnerId === challenge.challenger_id
          ? challenge.challenger.position
          : challenge.challenged.position;
      const oldLoserPosition =
        loserId === challenge.challenger_id
          ? challenge.challenger.position
          : challenge.challenged.position;

      try {
        await this.rules.processWin(challengeId, winnerId, loserId);
        await this.rules.applyPostMatchStatus(winnerId, loserId);
        await this.rules.updateStats(winnerId, loserId);

        // Logros: después del corrimiento, porque varios leen la posición nueva.
        await this.achievements.evaluateAfterChallenge({
          winnerId,
          loserId,
          score: result1.score,
          oldWinnerPosition,
          oldLoserPosition,
        });

        await this.prisma.challenge.update({
          where: { id: challengeId },
          data: {
            status: 'completed',
            winner_id: winnerId,
            final_score: result1.score,
            results_match: true,
            played_at: new Date(),
            resolved_at: new Date(),
          },
        });

        // Liberar la reserva del desafío
        await this.prisma.reservation.updateMany({
          where: { challenge_id: challengeId, status: 'active' },
          data: {
            status: 'cancelled',
            cancelled_at: new Date(),
            cancel_reason: 'Partido completado',
          },
        });

        const winner = await this.prisma.player.findUnique({
          where: { id: winnerId },
          select: { id: true, name: true, position: true, phone: true },
        });
        const loser = await this.prisma.player.findUnique({
          where: { id: loserId },
          select: { id: true, name: true, position: true, phone: true },
        });
        if (!winner || !loser)
          throw new BadRequestException('Jugador no encontrado');

        this.notifyAsync(async () => {
          if (winner.phone) {
            await whatsappService.sendMessage(
              winner.phone,
              `🎾 *Club de Tenis Graneros*\n\n🏆 ¡FELICIDADES!\n\nGanaste el partido contra ${loser.name}\nScore: ${result1.score}\n\nNueva posición: #${winner.position}`,
            );
            await this.sleep(600);
          }
          if (loser.phone) {
            await whatsappService.sendMessage(
              loser.phone,
              `🎾 *Club de Tenis Graneros*\n\nResultado confirmado\n\nPartido vs ${winner.name}\nScore: ${result1.score}\n\nNueva posición: #${loser.position}`,
            );
            await this.sleep(600);
          }
          const groupId = process.env.WHATSAPP_GROUP_ID;
          if (groupId) {
            const isRetirement =
              result1.score?.includes('Retiro') || result1.score === 'W.O.';
            const loserName =
              winnerId === challenge.challenger_id
                ? challenge.challenged.name
                : challenge.challenger.name;
            let msg = `🎾 *Escalerilla CTG — Resultado*\n\n🏆 *${winner.name}* venció a *${loserName}*\n📊 Score: *${result1.score}*\n\n📈 Nuevas posiciones:\n  • ${winner.name}: #${winner.position}\n  • ${loserName}: #${loser.position}`;
            if (isRetirement)
              msg += `\n\n_(Partido finalizado por retiro/lesión)_`;
            await whatsappService.sendGroupMessage(groupId, msg);
          }
          // positionsSwapped: misma condición que ChallengeRulesService.processWin.
          await this.notificationsService.notifyMatchResult({
            winnerId,
            loserId,
            winnerName: winner.name,
            loserName: loser.name,
            score: result1.score,
            positionsSwapped: oldWinnerPosition > oldLoserPosition,
            winnerPosition: winner.position,
            loserPosition: loser.position,
          });
        });

        this.appLogger.challengeResult(
          winner.name,
          loser.name,
          result1.score,
          winner.position,
          loser.position,
        );
        return {
          message: 'Resultado confirmado. Posiciones actualizadas.',
          winner: { name: winner.name, new_position: winner.position },
          loser: { name: loser.name, new_position: loser.position },
          score: result1.score,
        };
      } catch (error) {
        console.error('❌ Error en processDoubleConfirmation:', error);
        throw error;
      }
    } else {
      await this.prisma.challenge.update({
        where: { id: challengeId },
        data: { status: 'disputed' },
      });
      this.notifyAsync(async () => {
        const message = `🎾 *Club de Tenis Graneros*\n\n⚠️ Los resultados no coinciden.\n\nUn administrador revisará el caso.\n\n${challenge.challenger.name} dice: ${result1.score}\n${challenge.challenged.name} dice: ${result2.score}`;
        if (challenge.challenger.phone) {
          await whatsappService.sendMessage(
            challenge.challenger.phone,
            message,
          );
          await this.sleep(600);
        }
        if (challenge.challenged.phone) {
          await whatsappService.sendMessage(
            challenge.challenged.phone,
            message,
          );
        }
        // Extra (no pedido explícitamente en el spec, pero mismo criterio que
        // el resto de eventos de desafío): avisar a ambos que hay una disputa
        // pendiente de resolución por un admin. No hay result_confirmed aquí
        // porque el resultado todavía no está confirmado.
        await this.notificationsService.create(challenge.challenger.id, {
          type: 'result_disputed',
          title: 'Resultados no coinciden',
          body: `Un administrador revisará el partido vs ${challenge.challenged.name}.`,
          action_path: '/fixture',
        });
        await this.notificationsService.create(challenge.challenged.id, {
          type: 'result_disputed',
          title: 'Resultados no coinciden',
          body: `Un administrador revisará el partido vs ${challenge.challenger.name}.`,
          action_path: '/fixture',
        });
      });
      this.appLogger.challengeDisputed(
        challenge.challenger.name,
        challenge.challenged.name,
        result1.score,
        result2.score,
      );
      return {
        message:
          'Los resultados no coinciden. Un administrador debe revisar el caso.',
        status: 'disputed',
        challenger_says: result1,
        challenged_says: result2,
      };
    }
  }
}
