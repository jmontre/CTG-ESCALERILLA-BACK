import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChallengeRulesService } from '../challenges/challenge-rules.service';
import { whatsappService } from '../notifications/whatsapp.service';
import { AppLogger } from '../common/app.logger';
import { nowInChile } from '../common/dates';
import { AchievementsService } from '../achievements/achievements.service';
import { NotificationsService } from '../notifications/notifications.service';

// Cada 6 horas: 00:00, 06:00, 12:00, 18:00
const EVERY_6_HOURS = '0 0,6,12,18 * * *';

// Cada hora en punto
const EVERY_HOUR = '0 * * * *';

// Todos los lunes a las 00:00
const EVERY_MONDAY_MIDNIGHT = '0 0 * * 1';

// Horas de gracia para que el segundo jugador confirme su resultado
const HOURS_TO_CONFIRM_RESULT = 4;

@Injectable()
export class ChallengesCronService {
  private readonly logger = new Logger(ChallengesCronService.name);

  constructor(
    private prisma: PrismaService,
    private rules: ChallengeRulesService,
    private appLogger: AppLogger,
    private achievements: AchievementsService,
    private notifications: NotificationsService,
  ) {}

  @Cron(EVERY_6_HOURS)
  async handleExpiredChallenges() {
    this.logger.log('⏰ Iniciando verificación de desafíos expirados...');

    const now = new Date();
    let notAccepted = 0;
    let notPlayed = 0;
    let notConfirmed = 0;

    try {
      notAccepted = await this.handleNotAccepted(now);
      notPlayed = await this.handleNotPlayed(now);
      notConfirmed = await this.handleNotConfirmed(now);

      this.logger.log(`✅ Procesamiento completo:`);
      this.logger.log(`   - No aceptados: ${notAccepted}`);
      this.logger.log(`   - No jugados: ${notPlayed}`);
      this.logger.log(`   - No confirmados: ${notConfirmed}`);
    } catch (error) {
      this.logger.error('❌ Error en cron job:', error);
    }
  }

  private async handleNotAccepted(now: Date): Promise<number> {
    const expired = await this.prisma.challenge.findMany({
      where: { status: 'pending', accept_deadline: { lt: now } },
      include: { challenger: true, challenged: true },
    });

    const scheme = await this.activeCategoryScheme();

    for (const challenge of expired) {
      this.logger.warn(
        `⏱️  Desafío expirado (no aceptado): ${challenge.challenger.name} vs ${challenge.challenged.name}`,
      );

      // Un desafiante que viene de ganar por W.O. necesita 3 partidos jugados
      // de verdad para que otro le cuente. Si no los tiene, el desafío se
      // anula: no se mueve nadie y al ausente tampoco le suma.
      const claimable = await this.rules.canClaimWalkover(
        challenge.challenger_id,
      );
      if (!claimable) {
        await this.prisma.challenge.update({
          where: { id: challenge.id },
          data: {
            status: 'cancelled',
            resolved_at: now,
            final_score: 'W.O. no válido (3 partidos pendientes)',
          },
        });
        this.logger.log(
          `↩️  W.O. anulado: ${challenge.challenger.name} aún no juega 3 partidos desde su último W.O.`,
        );
        await this.notifications.create(challenge.challenger_id, {
          type: 'challenge_cancelled',
          title: 'Desafío anulado',
          body:
            `${challenge.challenged.name} no respondió, pero tu W.O. no cuenta: ` +
            `necesitas jugar 3 partidos desde el último.`,
          action_path: '/fixture',
        });
        continue;
      }

      // No responder tiene el mismo efecto que rechazar: el ausente baja al
      // puesto del desafiante y los del medio suben uno.
      await this.rules.processDecline(
        challenge.id,
        challenge.challenger_id,
        challenge.challenged_id,
        'challenge_not_answered',
      );
      await this.rules.applyPostMatchStatus(
        challenge.challenger_id,
        challenge.challenged_id,
      );
      await this.rules.recordWalkoverWin(challenge.challenger_id);

      // Además, castigo por ausencias repetidas (contador propio).
      const demotedTo = await this.rules.applyNoResponsePenalty(
        challenge.challenged_id,
        scheme,
      );

      await this.prisma.challenge.update({
        where: { id: challenge.id },
        data: { status: 'expired_not_accepted', resolved_at: now },
      });

      // Notificar al grupo
      try {
        const winner = await this.prisma.player.findUnique({
          where: { id: challenge.challenger_id },
        });
        const loser = await this.prisma.player.findUnique({
          where: { id: challenge.challenged_id },
        });
        const groupId = process.env.WHATSAPP_GROUP_ID;

        if (groupId && winner && loser) {
          await whatsappService.sendGroupMessage(
            groupId,
            `🎾 *Escalerilla CTG — W.O. automático*\n\n` +
              `${loser.name} no respondió el desafío a tiempo.\n\n` +
              `📈 ${winner.name}: #${winner.position}\n` +
              `📉 ${loser.name}: #${loser.position}` +
              (demotedTo
                ? `\n\n⚠️ Segunda ausencia seguida: baja al último de su categoría.`
                : ''),
          );
        }
        if (loser) {
          await this.notifications.create(loser.id, {
            type: 'position_down',
            title: demotedTo
              ? 'Bajaste al final de tu categoría'
              : 'No respondiste a tiempo',
            body: demotedTo
              ? `Ausencias seguidas: bajaste al final de tu categoría, ahora eres #${loser.position}. Juega un partido y el contador vuelve a cero.`
              : `No respondiste el desafío de ${challenge.challenger.name}. Ahora eres #${loser.position}.`,
            action_path: '/fixture',
          });
        }
      } catch (err) {
        this.logger.error('⚠️ Error notificando grupo:', err);
      }

      this.logger.log(`✅ W.O. aplicado: ${challenge.challenger.name} sube`);
      this.appLogger.challengeExpiredNotAccepted(
        challenge.challenger.name,
        challenge.challenged.name,
      );
    }

    return expired.length;
  }

  /** Esquema de categorías de la temporada abierta (ver common/ladder.ts). */
  private async activeCategoryScheme(): Promise<'legacy4' | 'v2'> {
    const season = await this.prisma.season.findFirst({
      where: { status: 'active' },
      orderBy: { started_at: 'desc' },
      select: { category_scheme: true },
    });
    return season?.category_scheme === 'legacy4' ? 'legacy4' : 'v2';
  }

  private async handleNotPlayed(now: Date): Promise<number> {
    const expired = await this.prisma.challenge.findMany({
      where: { status: 'accepted', play_deadline: { lt: now } },
      include: { challenger: true, challenged: true },
    });

    for (const challenge of expired) {
      this.logger.warn(
        `⏱️  Desafío expirado (no jugado): ${challenge.challenger.name} vs ${challenge.challenged.name}`,
      );

      await this.penalizeBothPlayers(challenge);

      await this.prisma.challenge.update({
        where: { id: challenge.id },
        data: { status: 'expired_not_played', resolved_at: now },
      });

      // Notificar al grupo
      try {
        const groupId = process.env.WHATSAPP_GROUP_ID;
        if (groupId) {
          await whatsappService.sendGroupMessage(
            groupId,
            `🎾 *Escalerilla CTG — Partido no jugado*\n\n` +
              `⏰ ${challenge.challenger.name} vs ${challenge.challenged.name}\n` +
              `El partido venció sin jugarse. Se aplicó penalización.`,
          );
        }
      } catch (err) {
        this.logger.error('⚠️ Error notificando grupo:', err);
      }

      this.logger.log(`✅ Penalización aplicada`);
      this.appLogger.challengeExpiredNotPlayed(
        challenge.challenger.name,
        challenge.challenged.name,
      );
    }

    return expired.length;
  }

  private async handleNotConfirmed(now: Date): Promise<number> {
    const allAccepted = await this.prisma.challenge.findMany({
      where: { status: 'accepted' },
      include: { challenger: true, challenged: true },
    });

    const pending = allAccepted.filter((c) => {
      const hasChallenger = c.challenger_result !== null;
      const hasChallenged = c.challenged_result !== null;
      return (
        (hasChallenger && !hasChallenged) || (!hasChallenger && hasChallenged)
      );
    });

    let processed = 0;

    for (const challenge of pending) {
      const referenceTime = challenge.first_result_at ?? challenge.accepted_at;
      if (!referenceTime) continue;

      const hoursSinceFirstResult =
        (now.getTime() - new Date(referenceTime).getTime()) / (1000 * 60 * 60);

      if (hoursSinceFirstResult < HOURS_TO_CONFIRM_RESULT) {
        this.logger.log(
          `⏳ ${challenge.challenger.name} vs ${challenge.challenged.name}: ` +
            `${hoursSinceFirstResult.toFixed(1)}h desde primer resultado (mínimo ${HOURS_TO_CONFIRM_RESULT}h)`,
        );
        continue;
      }

      this.logger.warn(
        `⏱️  Resultado sin doble confirmación: ${challenge.challenger.name} vs ${challenge.challenged.name}`,
      );

      const confirmedResult: any =
        challenge.challenger_result || challenge.challenged_result;
      const winnerId = confirmedResult.winnerId;
      const loserId =
        winnerId === challenge.challenger_id
          ? challenge.challenged_id
          : challenge.challenger_id;

      await this.rules.processWin(challenge.id, winnerId, loserId);
      await this.rules.applyPostMatchStatus(winnerId, loserId);
      await this.rules.updateStats(winnerId, loserId);

      // Logros: el resultado quedó validado, cuenta como partido jugado.
      await this.achievements.evaluateAfterChallenge({
        winnerId,
        loserId,
        score: confirmedResult.score,
        oldWinnerPosition:
          challenge.challenger_id === winnerId
            ? challenge.challenger.position
            : challenge.challenged.position,
        oldLoserPosition:
          challenge.challenger_id === loserId
            ? challenge.challenger.position
            : challenge.challenged.position,
      });

      await this.prisma.challenge.update({
        where: { id: challenge.id },
        data: {
          status: 'completed',
          winner_id: winnerId,
          final_score: confirmedResult.score,
          results_match: false,
          played_at: now,
          resolved_at: now,
        },
      });

      // Notificar al grupo
      try {
        const winner = await this.prisma.player.findUnique({
          where: { id: winnerId },
        });
        const loser = await this.prisma.player.findUnique({
          where: { id: loserId },
        });
        const groupId = process.env.WHATSAPP_GROUP_ID;

        if (groupId && winner && loser) {
          await whatsappService.sendGroupMessage(
            groupId,
            `🎾 *Escalerilla CTG — Resultado auto-validado*\n\n` +
              `🏆 *${winner.name}* venció a *${loser.name}*\n` +
              `📊 Score: *${confirmedResult.score}*\n\n` +
              `📈 Nuevas posiciones:\n` +
              `  • ${winner.name}: #${winner.position}\n` +
              `  • ${loser.name}: #${loser.position}\n\n` +
              `_(Solo un jugador confirmó el resultado)_`,
          );
        }

        // Notificar al jugador que no confirmó
        const nonConfirmer = challenge.challenger_result
          ? challenge.challenged
          : challenge.challenger;
        if (nonConfirmer.phone) {
          await whatsappService.sendMessage(
            nonConfirmer.phone,
            `🎾 *Club de Tenis Graneros*\n\n` +
              `⏰ El resultado del partido vs ${challenge.challenger_result ? challenge.challenger.name : challenge.challenged.name} fue auto-validado porque no ingresaste tu resultado a tiempo.\n\n` +
              `Score registrado: ${confirmedResult.score}`,
          );
        }
      } catch (err) {
        this.logger.error('⚠️ Error notificando resultado auto-validado:', err);
      }

      this.logger.log(
        `✅ Resultado auto-validado (${HOURS_TO_CONFIRM_RESULT}h sin confirmación)`,
      );
      this.appLogger.challengeAutoValidated(
        winnerId === challenge.challenger_id
          ? challenge.challenger.name
          : challenge.challenged.name,
        winnerId === challenge.challenger_id
          ? challenge.challenged.name
          : challenge.challenger.name,
        confirmedResult.score,
      );
      processed++;
    }

    return processed;
  }

  private async penalizeBothPlayers(challenge: any) {
    const challenger = await this.prisma.player.findUnique({
      where: { id: challenge.challenger_id },
    });

    if (!challenger) {
      console.log('⚠️  Challenger no existe');
      return;
    }

    console.log(
      `⚠️  Penalizando solo al challenger: ${challenger.name} (pos ${challenger.position})`,
    );

    const playerBelow = await this.prisma.player.findFirst({
      where: { position: challenger.position + 1 },
    });

    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.rankingHistory.create({
        data: {
          player_id: challenger.id,
          old_position: challenger.position,
          position: challenger.position + 1,
          reason: 'penalty',
        },
      }),
    ];

    if (playerBelow) {
      ops.push(
        this.prisma.rankingHistory.create({
          data: {
            player_id: playerBelow.id,
            old_position: playerBelow.position,
            position: playerBelow.position - 1,
            reason: 'opponent_penalty',
          },
        }),
      );
    }

    ops.push(
      this.prisma.player.update({
        where: { id: challenger.id },
        data: { position: 9999 },
      }),
    );
    if (playerBelow) {
      ops.push(
        this.prisma.player.update({
          where: { id: playerBelow.id },
          data: { position: challenger.position },
        }),
      );
    }
    ops.push(
      this.prisma.player.update({
        where: { id: challenger.id },
        data: { position: challenger.position + 1 },
      }),
    );

    await this.prisma.$transaction(ops);

    console.log(`✅ Penalización aplicada: ${challenger.name} baja 1 posición`);
  }

  @Cron(EVERY_HOUR)
  async handleExpiredReservations() {
    this.logger.log('⏰ Verificando reservas expiradas...');
    const now = nowInChile();

    try {
      const active = await this.prisma.reservation.findMany({
        where: { status: 'active' },
      });

      let completed = 0;

      for (const reservation of active) {
        const datePart = reservation.date.toISOString().split('T')[0];

        // Hora de término en Chile naive = inicio + 90 minutos
        const endTime = new Date(`${datePart}T${reservation.time_slot}:00`);
        endTime.setMinutes(endTime.getMinutes() + 90);

        if (endTime < now) {
          await this.prisma.reservation.update({
            where: { id: reservation.id },
            data: { status: 'completed', cancelled_at: endTime },
          });
          completed++;
        }
      }

      this.logger.log(`✅ Reservas completadas automáticamente: ${completed}`);
      this.appLogger.reservationCompleted(completed);
    } catch (error) {
      this.logger.error('❌ Error procesando reservas expiradas:', error);
    }
  }

  @Cron(EVERY_MONDAY_MIDNIGHT)
  async handleWeeklyHighDemandReset() {
    this.logger.log(
      '🔄 Lunes 00:00 — Cupos de alta demanda restaurados automáticamente.',
    );

    try {
      // El cupo es query-based (se cuenta contra el rango lunes-domingo),
      // por lo que no hay nada que actualizar en la DB — el cambio de semana
      // ya lo reinicia. Este cron valida que el proceso funcione y registra el evento.
      const players = await this.prisma.player.findMany({
        where: { position: { gt: 0 } },
        select: { id: true, name: true, member_type: true },
      });

      const socios = players.filter((p) => p.member_type === 'socio').length;
      const hijos = players.filter(
        (p) => p.member_type === 'hijo_socio',
      ).length;

      this.logger.log(
        `✅ Reset semanal: ${socios} socios (2 cupos c/u) · ${hijos} hijos de socio (1 cupo c/u)`,
      );
    } catch (error) {
      this.logger.error('❌ Error en reset semanal de cupos:', error);
    }
  }

  async runManually() {
    this.logger.log('🔧 Ejecución manual del cron job');
    await this.handleExpiredChallenges();
    await this.handleExpiredReservations();
  }
}
