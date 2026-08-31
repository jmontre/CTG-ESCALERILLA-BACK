import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AchievementsService } from './achievements.service';
import { PrismaService } from '../prisma/prisma.service';
import { ACHIEVEMENTS, GROUP_LABELS } from './achievements.catalog';

type AuthedRequest = Request & { user: { sub: string } };

@Controller('achievements')
export class AchievementsController {
  constructor(
    private achievements: AchievementsService,
    private prisma: PrismaService,
  ) {}

  /** Catálogo completo, sin estado de desbloqueo. */
  @Get('catalog')
  catalog() {
    return { groups: GROUP_LABELS, achievements: ACHIEVEMENTS };
  }

  /** Catálogo + qué tengo desbloqueado (grilla del perfil). */
  @Get('me')
  async mine(@Req() req: AuthedRequest) {
    const playerId = await this.playerId(req.user.sub);
    if (!playerId)
      return {
        total: ACHIEVEMENTS.length,
        unlocked_count: 0,
        achievements: [],
      };
    return this.achievements.findForPlayer(playerId);
  }

  /** Logros nuevos que todavía no vi (modal "¡Logro desbloqueado!"). */
  @Get('me/pending')
  async pending(@Req() req: AuthedRequest) {
    const playerId = await this.playerId(req.user.sub);
    if (!playerId) return [];
    return this.achievements.findPending(playerId);
  }

  @Post('me/seen')
  async markSeen(@Req() req: AuthedRequest, @Body() body: { ids: string[] }) {
    const playerId = await this.playerId(req.user.sub);
    if (!playerId) return { marked: 0 };
    return this.achievements.markSeen(playerId, body.ids ?? []);
  }

  /** Insignias de otro jugador (perfil público desde la escalerilla). */
  @Get('player/:playerId')
  byPlayer(@Param('playerId') playerId: string) {
    return this.achievements.findUnlockedForPlayer(playerId);
  }

  private async playerId(userId: string): Promise<string | null> {
    const player = await this.prisma.player.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    return player?.id ?? null;
  }
}
