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
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ReservationsService } from './reservations.service';
import { Admin } from '../auth/admin.decorator';
import { Public } from '../auth/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Controller('reservations')
export class ReservationsController {
  constructor(private reservationsService: ReservationsService) {}

  @Admin()
  @Get('blocks')
  getBlocks(@Query('date') date: string) {
    return this.reservationsService.getBlocks(date);
  }

  @Admin()
  @Post('blocks')
  setBlocks(
    @Body()
    body: {
      court_id: string;
      date: string;
      slots: string[];
      reason?: string;
    },
  ) {
    return this.reservationsService.setBlocks(
      body.court_id,
      body.date,
      body.slots,
      body.reason,
    );
  }

  @Admin()
  @Delete('blocks/:id')
  deleteBlock(@Param('id') id: string) {
    return this.reservationsService.deleteBlock(id);
  }

  @Get('courts')
  getCourts() {
    return this.reservationsService.getCourts();
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('availability')
  getAvailability(
    @Query('date') date: string,
    @Req() req: Request & { user?: { sub: string } },
  ) {
    if (!date) throw new UnauthorizedException('Debes indicar una fecha.');
    // Solo requests autenticadas ven partner_name/guest_name (PII de terceros).
    return this.reservationsService.getAvailability(date, !!req.user);
  }

  @Get('season')
  getSeason() {
    return this.reservationsService.getSeason().then((season) => ({ season }));
  }

  @Admin()
  @Post('season')
  setSeason(@Body() body: { season: string }) {
    return this.reservationsService.setSeason(body.season);
  }

  // Rutas estáticas ANTES de rutas con parámetros (:id)
  @Admin()
  @Get('stats')
  getStats(@Query('month') month?: string) {
    return this.reservationsService.getStats(month);
  }

  @Get('light-config')
  getLightConfig(@Query('date') date: string) {
    return this.reservationsService.getLightConfig(date);
  }

  @Admin()
  @Post('light-config')
  setLightConfig(
    @Body()
    body: {
      date: string;
      time_slots: string[];
      amount_per_slot: number;
    },
  ) {
    return this.reservationsService.setLightConfig(
      body.date,
      body.time_slots,
      body.amount_per_slot,
    );
  }

  @Admin()
  @Get('light-summary')
  getLightSummary(@Query('month') month: string) {
    return this.reservationsService.getLightSummary(month);
  }

  @Get('my')
  getMyReservations(@Req() req: Request & { user: { sub: string } }) {
    return this.reservationsService.getMyReservations(req.user.sub);
  }

  @Admin()
  @Get('player/:playerId')
  getPlayerReservations(@Param('playerId') playerId: string) {
    return this.reservationsService.getPlayerReservations(playerId);
  }

  @Admin()
  @Get()
  getAllReservations(
    @Query('date') date?: string,
    @Query('month') month?: string,
  ) {
    return this.reservationsService.getAllReservations(date, month);
  }

  @Post()
  create(
    @Req() req: Request & { user: { sub: string } },
    @Body() body: CreateReservationDto,
  ) {
    return this.reservationsService.create(req.user.sub, body);
  }

  @Patch(':id/modify')
  modify(
    @Req() req: Request & { user: { sub: string } },
    @Param('id') id: string,
    @Body() body: CreateReservationDto,
  ) {
    return this.reservationsService.modify(req.user.sub, id, body);
  }

  @Delete(':id')
  cancel(
    @Req() req: Request & { user: { sub: string } },
    @Param('id') id: string,
  ) {
    return this.reservationsService.cancel(req.user.sub, id);
  }

  @Admin()
  @Delete(':id/admin')
  adminCancel(@Param('id') id: string, @Body() body?: { reason?: string }) {
    return this.reservationsService.adminCancel(id, body?.reason);
  }
}
