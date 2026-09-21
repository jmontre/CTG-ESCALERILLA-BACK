import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  Req,
  Request,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PlayersService } from './players.service';

@Controller('players')
export class PlayersController {
  constructor(private playersService: PlayersService) {}

  @Get()
  findAll() {
    return this.playersService.findAll();
  }

  @Get('user/:userId')
  findByUserId(@Param('userId') userId: string, @Request() req: any) {
    if (userId !== req.user.sub && !req.user.is_admin) {
      throw new ForbiddenException(
        'No tienes permiso para acceder a este perfil',
      );
    }
    return this.playersService.findByUserId(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.playersService.findOne(id, {
      sub: req.user.sub,
      is_admin: req.user.is_admin,
    });
  }

  /** Últimos partidos jugados: los muestra la ficha del jugador. */
  @Get(':id/recent-matches')
  getRecentMatches(@Param('id') id: string) {
    return this.playersService.recentMatches(id);
  }

  @Get(':id/available-challenges')
  getAvailableChallenges(@Param('id') id: string) {
    return this.playersService.getAvailableChallenges(id);
  }

  /**
   * PUT /players/me
   * Actualizar perfil del jugador autenticado
   */
  @Put('me')
  async updateMe(
    @Req() req: any,
    @Body()
    body: {
      name?: string;
      phone?: string;
      current_password?: string;
      new_password?: string;
    },
  ) {
    return this.playersService.updateMe(req.user.sub, body);
  }

  @Post('me/avatar')
  async uploadAvatar(@Req() req: any, @Body() body: { image: string }) {
    if (!body.image) throw new BadRequestException('imagen requerida');
    return this.playersService.uploadAvatar(req.user.sub, body.image);
  }

  @Delete('me/avatar')
  async deleteAvatar(@Req() req: any) {
    return this.playersService.deleteAvatar(req.user.sub);
  }
}
