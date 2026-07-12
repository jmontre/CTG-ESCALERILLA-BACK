import { Module } from '@nestjs/common';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';
import { AdminChallengesController } from './admin-challenges.controller';
import { AdminChallengesService } from './admin-challenges.service';
import { ChallengeRulesService } from './challenge-rules.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ChallengesController, AdminChallengesController],
  providers: [ChallengesService, AdminChallengesService, ChallengeRulesService],
  exports: [ChallengesService, ChallengeRulesService],
})
export class ChallengesModule {}
