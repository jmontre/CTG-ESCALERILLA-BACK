import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { AdminChallengesService } from './admin-challenges.service';
import { ChallengeRulesService } from './challenge-rules.service';
import { Admin } from '../auth/admin.decorator';

@Admin()
@Controller('admin/challenges')
export class AdminChallengesController {
  constructor(
    private adminService: AdminChallengesService,
    private rules: ChallengeRulesService,
  ) {}

  /**
   * Tope del partido de ingreso: el puesto más alto al que puede apuntar
   * quien entra o vuelve a la escalerilla.
   * Va antes de las rutas con `:id` para que "entry-limit" no se lea como id.
   */
  @Get('entry-limit')
  async getEntryLimit() {
    return { top_limit: await this.rules.entryMatchTopLimit() };
  }

  @Post('entry-limit')
  async setEntryLimit(@Body() body: { top_limit: number }) {
    const limit = await this.rules.setEntryMatchTopLimit(
      Number(body?.top_limit),
    );
    return {
      top_limit: limit,
      message: `El partido de ingreso se juega del puesto #${limit} hacia abajo.`,
    };
  }

  @Post(':id/resolve')
  async resolveChallenge(
    @Param('id') id: string,
    @Body() data: { winnerId: string; score: string },
  ) {
    return this.adminService.resolveChallenge(id, data.winnerId, data.score);
  }

  @Delete(':id')
  async cancelChallenge(@Param('id') id: string) {
    return this.adminService.cancelChallenge(id);
  }

  @Delete(':id/force')
  async forceDelete(@Param('id') id: string) {
    return this.adminService.forceDelete(id);
  }

  @Post(':id/extend')
  async extendDeadline(
    @Param('id') id: string,
    @Body() data: { hours: number; type: 'accept' | 'play' },
  ) {
    return this.adminService.extendDeadline(id, data.hours, data.type);
  }
}
