import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { MasterService } from './master.service';
import { Admin } from '../auth/admin.decorator';

@Controller('master')
export class MasterController {
  constructor(private masterService: MasterService) {}

  /** Cuadros de una temporada (`?season=2026-1`). Sin parámetro, la abierta. */
  @Get()
  findAll(@Query('season') season?: string) {
    return this.masterService.findAll(season);
  }

  /**
   * Temporadas elegibles en el filtro. Va ANTES de `:category` o la ruta
   * paramétrica se lo come ("seasons" pasaría por categoría).
   */
  @Get('seasons')
  seasons() {
    return this.masterService.seasons();
  }

  @Get(':category')
  findByCategory(
    @Param('category') category: string,
    @Query('season') season?: string,
  ) {
    return this.masterService.findByCategory(category.toUpperCase(), season);
  }

  @Admin()
  @Post('generate')
  generate(
    @Body()
    body: {
      category: string;
      name?: string;
      round_robin_start?: string;
      round_robin_end?: string;
      final_date?: string;
    },
  ) {
    return this.masterService.generateMaster({
      ...body,
      category: body.category.toUpperCase(),
    });
  }

  /**
   * PATCH /master/matches/:id/schedule
   * Fijar fecha (jugador autenticado)
   */
  @Patch('matches/:id/schedule')
  scheduleMatch(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { scheduled_date: string; court_id?: string },
  ) {
    return this.masterService.scheduleMatch(
      id,
      req.user.sub,
      new Date(body.scheduled_date),
      body.court_id,
    );
  }

  @Post('matches/:id/player-result')
  submitPlayerResult(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { winner_id: string; score: string },
  ) {
    return this.masterService.submitPlayerResult(id, req.user.sub, {
      winnerId: body.winner_id,
      score: body.score,
    });
  }

  /**
   * POST /master/matches/:id/result
   * Ingresar resultado directo (admin)
   */
  @Admin()
  @Post('matches/:id/result')
  submitResult(
    @Param('id') id: string,
    @Body() body: { winner_id: string; score: string },
  ) {
    return this.masterService.submitResult(id, body.winner_id, body.score);
  }

  @Admin()
  @Post(':seasonId/check-final')
  checkFinal(@Param('seasonId') seasonId: string) {
    return this.masterService.checkAndGenerateFinal(seasonId);
  }

  @Admin()
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.masterService.deleteSeason(id);
  }
}
