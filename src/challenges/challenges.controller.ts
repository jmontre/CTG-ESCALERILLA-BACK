import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  BadRequestException,
  Request,
  Query,
} from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';

@Controller('challenges')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  /**
   * POST /challenges
   * Crear un nuevo desafío — el challenger es siempre el usuario autenticado.
   */
  @Post()
  async create(@Body() dto: CreateChallengeDto, @Request() req: any) {
    const challengerId = await this.challengesService.getPlayerIdFromUserId(
      req.user.sub,
    );
    return this.challengesService.create(challengerId, dto.challenged_id);
  }

  /**
   * GET /challenges
   * Listar todos los desafíos
   */
  @Get()
  findAll() {
    return this.challengesService.findAll();
  }

  /**
   * GET /challenges/:id
   * Obtener un desafío específico
   */
  /**
   * GET /challenges/history?period=all|2026|2026-1
   * Historial del usuario autenticado con las stats del período elegido.
   * Va ANTES de :id, o "history" se interpretaría como un id de desafío.
   */
  /**
   * GET /challenges/entry/targets
   * Rivales elegibles para el partido de ingreso del jugador logueado.
   * Va ANTES de :id, o "entry" se leería como id de desafío.
   */
  @Get('entry/targets')
  async entryTargets(@Request() req: any) {
    const playerId = await this.challengesService.getPlayerIdFromUserId(
      req.user.sub,
    );
    return this.challengesService.entryMatchTargets(playerId);
  }

  /**
   * POST /challenges/entry
   * Partido de ingreso: quien entra o vuelve a la escalerilla elige rival.
   */
  @Post('entry')
  async createEntry(
    @Body() body: { challenged_id: string },
    @Request() req: any,
  ) {
    if (!body?.challenged_id)
      throw new BadRequestException('Falta el jugador a desafiar');
    const entrantId = await this.challengesService.getPlayerIdFromUserId(
      req.user.sub,
    );
    return this.challengesService.createEntry(entrantId, body.challenged_id);
  }

  @Get('history')
  async history(@Request() req: any, @Query('period') period?: string) {
    const playerId = await this.challengesService.getPlayerIdFromUserId(
      req.user.sub,
    );
    return this.challengesService.historyForPlayer(playerId, period ?? 'all');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.challengesService.findOne(id);
  }

  /**
   * POST /challenges/:id/accept
   * Aceptar un desafío — el jugador que acepta es siempre el usuario autenticado.
   */
  @Post(':id/accept')
  async accept(@Param('id') id: string, @Request() req: any) {
    const playerId = await this.challengesService.getPlayerIdFromUserId(
      req.user.sub,
    );
    return this.challengesService.accept(id, playerId);
  }

  /**
   * POST /challenges/:id/reject
   * Rechazar un desafío — el jugador que rechaza es siempre el usuario autenticado.
   */
  @Post(':id/reject')
  async reject(@Param('id') id: string, @Request() req: any) {
    const playerId = await this.challengesService.getPlayerIdFromUserId(
      req.user.sub,
    );
    return this.challengesService.reject(id, playerId);
  }

  /**
   * POST /challenges/:id/result
   * Ingresar resultado del partido — el jugador que reporta es siempre el usuario autenticado.
   */
  @Post(':id/result')
  async submitResult(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { winner_id: string; score: string },
  ) {
    if (!body.winner_id || !body.score) {
      throw new BadRequestException('winner_id y score son requeridos');
    }
    const playerId = await this.challengesService.getPlayerIdFromUserId(
      req.user.sub,
    );
    return this.challengesService.submitResult(id, playerId, {
      winnerId: body.winner_id,
      score: body.score,
    });
  }

  /**
   * POST /challenges/:id/schedule
   * Fijar o actualizar la fecha acordada del partido — el jugador es el usuario autenticado.
   */
  @Post(':id/schedule')
  async scheduleMatch(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { scheduled_date: string; court_id?: string },
  ) {
    if (!body.scheduled_date) {
      throw new BadRequestException('scheduled_date es requerido');
    }
    const playerId = await this.challengesService.getPlayerIdFromUserId(
      req.user.sub,
    );
    return this.challengesService.scheduleMatch(
      id,
      playerId,
      new Date(body.scheduled_date),
      body.court_id,
    );
  }
}
