import { Module } from '@nestjs/common';
import { ChallengesCronService } from './challenges-cron.service';
import { MasterCronService } from './master-cron.service';
import { CronController } from './cron.controller';
import { AchievementsModule } from '../achievements/achievements.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChallengesModule } from '../challenges/challenges.module';

@Module({
  imports: [ChallengesModule, AchievementsModule, NotificationsModule],
  controllers: [CronController],
  providers: [ChallengesCronService, MasterCronService],
})
export class CronModule {}
