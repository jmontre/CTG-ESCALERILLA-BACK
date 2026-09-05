import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { AdminPlayersService } from './admin-players.service';
import { Admin } from '../auth/admin.decorator';
import { CreatePlayerDto, UpdatePlayerDto } from './dto/admin-player.dto';

@Admin()
@Controller('admin/players')
export class AdminPlayersController {
  constructor(private adminService: AdminPlayersService) {}

  /** GET /admin/players/all — todos los jugadores incluyendo los sin posición */
  @Get('all')
  async getAllPlayers() {
    return this.adminService.getAllPlayers();
  }

  @Post()
  async createPlayer(@Body() data: CreatePlayerDto) {
    return this.adminService.createPlayer(data);
  }

  @Put(':id')
  async updatePlayer(@Param('id') id: string, @Body() data: UpdatePlayerDto) {
    return this.adminService.updatePlayer(id, data);
  }

  @Delete(':id')
  async deletePlayer(@Param('id') id: string) {
    return this.adminService.deletePlayer(id);
  }

  @Post(':id/move')
  async movePlayer(
    @Param('id') id: string,
    @Body() data: { newPosition: number },
  ) {
    return this.adminService.movePlayer(id, data.newPosition);
  }

  /** Baja de la escalerilla conservando todos los datos del jugador. */
  @Post(':id/retire')
  async retireFromLadder(@Param('id') id: string) {
    return this.adminService.retireFromLadder(id);
  }

  /**
   * Reincorpora al retirado. Sin `position`, le habilita el partido de ingreso;
   * con `position`, lo ubica directo en ese puesto.
   */
  @Post(':id/rejoin')
  async rejoinLadder(
    @Param('id') id: string,
    @Body() body: { position?: number },
  ) {
    return this.adminService.rejoinLadder(id, body?.position);
  }

  @Post(':id/reset-immunity')
  async resetImmunity(@Param('id') id: string) {
    return this.adminService.resetImmunity(id);
  }

  @Post(':id/reset-vulnerability')
  async resetVulnerability(@Param('id') id: string) {
    return this.adminService.resetVulnerability(id);
  }

  /** GET /admin/players/:id/weekly-usage — cupos alta demanda usados esta semana */
  @Get(':id/weekly-usage')
  async getWeeklyUsage(@Param('id') id: string) {
    return this.adminService.getWeeklyHighDemandUsage(id);
  }
}
