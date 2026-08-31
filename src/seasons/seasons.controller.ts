import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { SeasonsService } from './seasons.service';
import { Admin } from '../auth/admin.decorator';

type AuthedRequest = Request & { user: { sub: string } };

@Controller('seasons')
export class SeasonsController {
  constructor(private seasons: SeasonsService) {}

  @Get()
  findAll() {
    return this.seasons.findAll();
  }

  /**
   * Períodos disponibles con sus rangos de fecha, para que las pantallas que
   * filtran localmente (el fixture del club) usen los mismos cortes que el
   * historial personal, en vez de recalcularlos por su cuenta.
   */
  @Get('periods')
  periods() {
    return this.seasons.periods();
  }

  /** Resumen de cierre para el modal del jugador logueado. */
  @Get('me/summary')
  summary(@Req() req: AuthedRequest) {
    return this.seasons.summaryForUser(req.user.sub);
  }

  @Post('me/summary/seen')
  markSeen(@Req() req: AuthedRequest, @Body() body: { slug: string }) {
    return this.seasons.markSummarySeen(req.user.sub, body.slug);
  }

  /** Ranking final histórico de una temporada cerrada. */
  @Get(':slug/standings')
  standings(@Param('slug') slug: string) {
    return this.seasons.standings(slug);
  }

  @Admin()
  @Post('open')
  open(@Body() body: { slug: string; name: string }) {
    return this.seasons.openSeason(body.slug, body.name);
  }

  @Admin()
  @Post(':slug/close')
  close(
    @Param('slug') slug: string,
    @Body() body: { master_season_name: string },
  ) {
    return this.seasons.closeSeason(slug, body.master_season_name);
  }
}
