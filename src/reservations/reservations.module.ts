import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { jwtModuleOptions } from '../auth/jwt.config';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync(jwtModuleOptions),
    NotificationsModule,
  ],
  controllers: [ReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
