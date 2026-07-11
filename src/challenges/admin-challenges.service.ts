import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChallengeRulesService } from './challenge-rules.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AdminChallengesService {
  constructor(
    private prisma: PrismaService,
    private rules: ChallengeRulesService,
    private notificationsService: NotificationsService,
  ) {}

  /** Dispara notificaciones sin bloquear la respuesta HTTP (igual que ChallengesService). */
  private notifyAsync(task: () => Promise<void>) {
    void task().catch((e) =>
      console.error('⚠️ Error notificaciones (async):', e),
    );
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

    // Misma lógica que el flujo normal: corrimiento + historial + inmunidad/vulnerabilidad + stats
    await this.rules.processWin(challengeId, winnerId, loserId);
    await this.rules.applyPostMatchStatus(winnerId, loserId);
    await this.rules.updateStats(winnerId, loserId);

    const updated = await this.prisma.challenge.update({
      where: { id: challengeId },
      data: {
        status: 'completed',
        winner_id: winnerId,
        final_score: score,
        resolved_at: new Date(),
        played_at: challenge.played_at || new Date(),
      },
      include: { challenger: true, challenged: true },
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
      await this.notificationsService.create(winnerId, {
        type: 'result_confirmed',
        title: 'Resultado confirmado',
        body: `Victoria ${score} vs ${loserName}.`,
        action_label: 'Ver historial',
        action_path: '/historial',
      });
      await this.notificationsService.create(loserId, {
        type: 'result_confirmed',
        title: 'Resultado confirmado',
        body: `Derrota ${score} vs ${winnerName}.`,
        action_path: '/historial',
      });
      if (oldWinnerPosition > oldLoserPosition) {
        await this.notificationsService.create(winnerId, {
          type: 'position_up',
          title: '🚀 ¡Subiste posiciones!',
          body: `Ahora eres #${winnerPosition} de la escalerilla.`,
          action_label: 'Ver escalerilla',
          action_path: '/escalerilla',
        });
        await this.notificationsService.create(loserId, {
          type: 'position_down',
          title: 'Bajaste de posición',
          body: `Ahora eres #${loserPosition}. ¡A recuperarla!`,
          action_path: '/escalerilla',
        });
      }
    });

    return updated;
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
