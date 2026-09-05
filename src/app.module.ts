import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CfThrottlerGuard } from './common/cf-throttler.guard';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { PlayersModule } from './players/players.module';
import { ChallengesModule } from './challenges/challenges.module';
import { CronModule } from './cron/cron.module';
import { MasterModule } from './master/master.module';
import { ReservationsModule } from './reservations/reservations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AchievementsModule } from './achievements/achievements.module';
import { SeasonsModule } from './seasons/seasons.module';
import { LadderModule } from './ladder/ladder.module';
import { TestController } from './test/test.controller';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production' ? '.env.production' : '.env.dev',
    }),
    // Red de seguridad global: 100 req/min por IP. El uso normal del club no lo roza.
    ThrottlerModule.forRoot([{ name: 'global', ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    LadderModule,
    AuthModule,
    PlayersModule,
    ChallengesModule,
    CronModule,
    MasterModule,
    ReservationsModule,
    NotificationsModule,
    AchievementsModule,
    SeasonsModule,
    CommonModule,
  ],
  controllers: [AppController, TestController],
  providers: [AppService, { provide: APP_GUARD, useClass: CfThrottlerGuard }],
})
export class AppModule {}
