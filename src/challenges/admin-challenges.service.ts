import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChallengeRulesService } from './challenge-rules.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../achievements/achievements.service';
import { whatsappService } from '../notifications/whatsapp.service';

@Injectable()
export class AdminChallengesService {
  constructor(
    private prisma: PrismaService,
    private rules: ChallengeRulesService,
    private notificationsService: NotificationsService,
    private achievements: AchievementsService,
  ) {}

  /** Dispara notificaciones sin bloquear la respuesta HTTP (igual que ChallengesService). */
  private notifyAsync(task: () => Promise<void>) {
    void task().catch((e) =>
      console.error('⚠️ Error notificaciones (async):', e),
    );
  }

  private loadWithPlayers(challengeId: string) {
    return this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: { challenger: true, challenged: true },
    });
  }

  async resolveChallenge(challengeId: string, winnerId: string, score: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: { challenger: true, challenged: true },
    });
    if (!challenge) throw new NotFoundException('Desafío no encontrado');

    if (
      winnerId !== challenge.challenger_id &&
      winnerId !== challenge.challenged_id
    ) {
      throw new BadRequestException(
        'El ganador debe ser uno de los jugadores del desafío',
      );
    }
    // Ya completado ("Actualizar Resultado" en el panel, o el segundo clic de
    // una resolución lenta): NO se vuelve a aplicar nada. Volver a correr
    // updateStats sumaba otra victoria y otra derrota cada vez — pasó 4 veces
    // en una semana. Con el mismo ganador solo se corrige el marcador; darlo
    // vuelta exigiría revertir estadísticas y posiciones del resultado anterior.
    if (challenge.status === 'completed') {
      if (challenge.winner_id !== winnerId) {
        throw new ConflictException(
          'Este desafío ya está completado con otro ganador. Cambiarlo de ganador no se ' +
            'aplica encima porque quedarían dos resultados contados. Anúlalo y vuelve a resolverlo.',
        );
      }
      return this.prisma.challenge.update({
        where: { id: challengeId },
        data: { final_score: score },
        include: { challenger: true, challenged: true },
      });
    }

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

    // Claim atómico ANTES de cualquier efecto (ver CLAUDE.md): el UPDATE
    // condicionado por el estado leído es la exclusión mutua. Si dos peticiones
    // leyeron el mismo estado, solo una lo reclama; la otra no aplica nada.
    const now = new Date();
    const claimed = await this.prisma.challenge.updateMany({
      where: { id: challengeId, status: challenge.status },
      data: {
        status: 'completed',
        winner_id: winnerId,
        final_score: score,
        resolved_at: now,
        played_at: challenge.played_at || now,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException(
        'Este desafío acaba de ser resuelto por otra solicitud. Recarga el panel para ver el resultado.',
      );
    }

    let updated: Awaited<ReturnType<typeof this.loadWithPlayers>>;
    try {
      // Misma lógica que el flujo normal: corrimiento + historial + inmunidad/vulnerabilidad + stats
      await this.rules.processWin(challengeId, winnerId, loserId);
      await this.rules.applyPostMatchStatus(winnerId, loserId);
      await this.rules.updateStats(winnerId, loserId);

      // Logros: mismo trato que el flujo normal de doble confirmación.
      await this.achievements.evaluateAfterChallenge({
        winnerId,
        loserId,
        score,
        oldWinnerPosition,
        oldLoserPosition,
      });

      // Liberar la reserva del desafío (igual que processDoubleConfirmation)
      await this.prisma.reservation.updateMany({
        where: { challenge_id: challengeId, status: 'active' },
        data: {
          status: 'cancelled',
          cancelled_at: new Date(),
          cancel_reason: 'Partido completado',
        },
      });

      // Relectura para tener las posiciones ya corridas (el estado lo fijó el claim).
      updated = await this.loadWithPlayers(challengeId);
      if (!updated) throw new NotFoundException('Desafío no encontrado');
    } catch (error) {
      console.error('❌ Error resolviendo desafío desde admin:', error);
      // Soltar el claim, igual que processDoubleConfirmation: si no, el desafío
      // quedaba "completado" sin estadísticas, y el reintento caía en "ya
      // completado, solo corrijo el marcador" — nunca se aplicaban. Solo se
      // revierte si sigue siendo el estado que dejó este claim.
      await this.prisma.challenge
        .updateMany({
          where: { id: challengeId, status: 'completed', winner_id: winnerId },
          data: {
            status: challenge.status,
            winner_id: challenge.winner_id ?? null,
            final_score: challenge.final_score ?? null,
            played_at: challenge.played_at ?? null,
            resolved_at: challenge.resolved_at ?? null,
          },
        })
        .catch((e) => console.error('⚠️ Error soltando el claim:', e));
      throw error;
    }

    const winnerName =
      winnerId === updated.challenger_id
        ? updated.challenger.name
        : updated.challenged.name;
    const loserName =
      loserId === updated.challenger_id
        ? updated.challenger.name
        : updated.challenged.name;
    const winnerPosition =
      winnerId === updated.challenger_id
        ? updated.challenger.position
        : updated.challenged.position;
    const loserPosition =
      loserId === updated.challenger_id
        ? updated.challenger.position
        : updated.challenged.position;

    this.notifyAsync(async () => {
      // El resultado se anuncia al grupo igual que en el flujo normal. Antes
      // solo lo hacía `processDoubleConfirmation`, así que un partido resuelto
      // por la comisión —una disputa, o un resultado cargado a mano— no se
      // enteraba nadie: la escalerilla cambiaba sin explicación.
      const groupId = process.env.WHATSAPP_GROUP_ID;
      if (groupId) {
        await whatsappService.sendGroupMessage(
          groupId,
          `🎾 *Escalerilla CTG — Resultado*\n\n` +
            `🏆 *${winnerName}* venció a *${loserName}*\n` +
            `📊 Score: *${score}*\n\n` +
            `📈 Nuevas posiciones:\n` +
            `  • ${winnerName}: #${winnerPosition}\n` +
            `  • ${loserName}: #${loserPosition}`,
        );
      }

      // positionsSwapped: misma condición que ChallengeRulesService.processWin.
      await this.notificationsService.notifyMatchResult({
        winnerId,
        loserId,
        winnerName,
        loserName,
        score,
        positionsSwapped: oldWinnerPosition > oldLoserPosition,
        winnerPosition,
        loserPosition,
      });
    });

    return updated;
  }

  /**
   * Anula los desafíos abiertos de un jugador, **sin efectos**: nadie sube,
   * nadie baja, nadie gana por W.O. y no se tocan las estadísticas.
   *
   * La usa la baja de cuenta. Sin esto, el desafío quedaba vivo y el cron lo
   * vencía igual: movía posiciones por un partido contra alguien que ya no
   * está en el club, dándole un W.O. al rival o penalizándolo por no jugar.
   *
   * Al rival se le avisa, porque estaba esperando ese partido.
   */
  async cancelOpenForPlayer(playerId: string, reason: string) {
    const abiertos = await this.prisma.challenge.findMany({
      where: {
        OR: [{ challenger_id: playerId }, { challenged_id: playerId }],
        status: { in: ['pending', 'accepted'] },
      },
      include: {
        challenger: { select: { id: true, name: true } },
        challenged: { select: { id: true, name: true } },
      },
    });

    const rivales: string[] = [];
    for (const challenge of abiertos) {
      // Claim atómico: si el cron lo está venciendo en este mismo momento, uno
      // de los dos pierde y no se procesa dos veces (ver CLAUDE.md).
      const claimed = await this.prisma.challenge.updateMany({
        where: { id: challenge.id, status: { in: ['pending', 'accepted'] } },
        data: {
          status: 'cancelled',
          resolved_at: new Date(),
          final_score: reason,
          // Sin fecha: el partido no se va a jugar, y dejarla puesta hacía que
          // el fixture mostrara día y hora de un desafío ya anulado.
          scheduled_date: null,
        },
      });
      if (claimed.count === 0) continue;

      // La cancha que hubieran reservado para jugarlo queda libre, sin importar
      // cuál de los dos la sacó.
      await this.prisma.reservation.updateMany({
        where: { challenge_id: challenge.id, status: 'active' },
        data: {
          status: 'cancelled',
          cancelled_at: new Date(),
          cancel_reason: reason,
        },
      });

      const rival =
        challenge.challenger_id === playerId
          ? challenge.challenged
          : challenge.challenger;
      rivales.push(rival.name);

      this.notifyAsync(async () => {
        await this.notificationsService.create(rival.id, {
          type: 'challenge_cancelled',
          title: 'Desafío anulado',
          body:
            `Tu desafío con ${challenge.challenger_id === playerId ? challenge.challenger.name : challenge.challenged.name} ` +
            `se anuló porque dejó el club. No cuenta como partido y no cambia tu posición.`,
          action_path: '/fixture',
        });
      });
    }

    return { cancelled: rivales.length, rivals: rivales };
  }

  async cancelChallenge(challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: { challenger: true, challenged: true },
    });

    if (!challenge) {
      throw new NotFoundException('Desafío no encontrado');
    }

    // Si estaba completado, revertir estadísticas
    if (challenge.status === 'completed' && challenge.winner_id) {
      const winnerId = challenge.winner_id;
      const loserId =
        winnerId === challenge.challenger_id
          ? challenge.challenged_id
          : challenge.challenger_id;

      const winner = await this.prisma.player.findUnique({
        where: { id: winnerId },
      });
      if (winner && winner.wins > 0 && winner.total_matches > 0) {
        await this.prisma.player.update({
          where: { id: winnerId },
          data: { wins: { decrement: 1 }, total_matches: { decrement: 1 } },
        });
      }

      const loser = await this.prisma.player.findUnique({
        where: { id: loserId },
      });
      if (loser && loser.losses > 0 && loser.total_matches > 0) {
        await this.prisma.player.update({
          where: { id: loserId },
          data: { losses: { decrement: 1 }, total_matches: { decrement: 1 } },
        });
      }
    }

    await this.prisma.challenge.update({
      where: { id: challengeId },
      data: { status: 'cancelled', resolved_at: new Date() },
    });

    return {
      message: 'Desafío cancelado correctamente',
      note:
        challenge.status === 'completed'
          ? 'Estadísticas revertidas. NOTA: Los cambios de ranking NO fueron revertidos automáticamente.'
          : null,
    };
  }

  /**
   * Eliminar el registro del desafío completamente de la DB.
   * Usar solo para datos de prueba o errores administrativos.
   */
  async forceDelete(challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Desafío no encontrado');
    }

    await this.prisma.challenge.delete({
      where: { id: challengeId },
    });

    return { message: 'Desafío eliminado permanentemente' };
  }

  async extendDeadline(
    challengeId: string,
    hours: number,
    type: 'accept' | 'play',
  ) {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Desafío no encontrado');
    }

    const updateData: any = {};

    if (type === 'accept') {
      const newDeadline = new Date(challenge.accept_deadline);
      newDeadline.setHours(newDeadline.getHours() + hours);
      updateData.accept_deadline = newDeadline;
    } else if (type === 'play') {
      const newDeadline = new Date(challenge.play_deadline);
      newDeadline.setHours(newDeadline.getHours() + hours);
      updateData.play_deadline = newDeadline;
    }

    const updated = await this.prisma.challenge.update({
      where: { id: challengeId },
      data: updateData,
      include: { challenger: true, challenged: true },
    });

    return {
      message: `Plazo ${type === 'accept' ? 'para aceptar' : 'para jugar'} extendido ${hours} horas`,
      challenge: updated,
    };
  }
}
