import { Controller, Get, Post, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  findMine(@Req() req: Request & { user: { sub: string } }) {
    return this.notifications.findForUser(req.user.sub);
  }

  // Ruta estática ANTES de rutas con parámetros (:id)
  @Post('read-all')
  markAllRead(@Req() req: Request & { user: { sub: string } }) {
    return this.notifications.markAllRead(req.user.sub);
  }

  @Post(':id/read')
  markRead(
    @Req() req: Request & { user: { sub: string } },
    @Param('id') id: string,
  ) {
    return this.notifications.markRead(req.user.sub, id);
  }
}
