import { Controller, Post } from '@nestjs/common';
import { ChallengesCronService } from './challenges-cron.service';
import { MasterCronService } from './master-cron.service';
import { Admin } from '../auth/admin.decorator';

@Admin()
@Controller('cron')
export class CronController {
  constructor(
    private cronService: ChallengesCronService,
    private masterCronService: MasterCronService,
  ) {}

  /**
   * POST /cron/run
   * Ejecutar manualmente el cron job (solo para testing)
   */
  @Post('run')
  async runCronManually() {
    await this.cronService.runManually();
    await this.masterCronService.handleUnconfirmedMasterResults();
    return {
      message: 'Cron job ejecutado manualmente',
      timestamp: new Date(),
    };
  }
}
