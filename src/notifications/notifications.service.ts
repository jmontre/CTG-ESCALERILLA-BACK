import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  action_label?: string;
  action_path?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /** Crea una notificación in-app. Nunca lanza: un fallo aquí no debe romper la operación principal. */
  async create(playerId: string, payload: NotificationPayload): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: { player_id: playerId, ...payload },
      });
    } catch (e) {
      console.error('⚠️ [notifications] Error creando notificación:', e);
    }
  }

  private async playerIdFromUser(userId: string): Promise<string | null> {
    const player = await this.prisma.player.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    return player?.id ?? null;
  }

  async findForUser(userId: string) {
    const playerId = await this.playerIdFromUser(userId);
    if (!playerId) return [];
    return this.prisma.notification.findMany({
      where: { player_id: playerId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: string, notificationId: string) {
    const playerId = await this.playerIdFromUser(userId);
    if (!playerId) return { updated: 0 };
    const res = await this.prisma.notification.updateMany({
      where: { id: notificationId, player_id: playerId },
      data: { read: true },
    });
    return { updated: res.count };
  }

  async markAllRead(userId: string) {
    const playerId = await this.playerIdFromUser(userId);
    if (!playerId) return { updated: 0 };
    const res = await this.prisma.notification.updateMany({
      where: { player_id: playerId, read: false },
      data: { read: true },
    });
    return { updated: res.count };
  }
}
