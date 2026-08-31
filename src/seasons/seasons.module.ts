import { Module } from '@nestjs/common';
import { SeasonsService } from './seasons.service';
import { SeasonsController } from './seasons.controller';
import { AchievementsModule } from '../achievements/achievements.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AchievementsModule, NotificationsModule],
  controllers: [SeasonsController],
  providers: [SeasonsService],
  exports: [SeasonsService],
})
export class SeasonsModule {}
