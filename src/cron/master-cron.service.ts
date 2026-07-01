import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { whatsappService } from '../notifications/whatsapp.service';

// Cada 6 horas: 00:00, 06:00, 12:00, 18:00
const EVERY_6_HOURS = '0 0,6,12,18 * * *';

// Horas de gracia tras la fecha agendada antes de recordar el resultado
const HOURS_TO_REMIND_RESULT = 2;

@Injectable()
export class MasterCronService {
  private readonly logger = new Logger(MasterCronService.name);

  constructor(private prisma: PrismaService) {}

  private async sendWsp(phone: string | null | undefined, message: string) {
    if (!phone) return;
    try {
      await whatsappService.sendMessage(phone, message);
    } catch (err) {
      this.logger.error(`⚠️ Error notificando a ${phone}:`, err);
    }
  }

  @Cron(EVERY_6_HOURS)
  async handleUnconfirmedMasterResults() {
    this.logger.log('⏰ Verificando partidos Master sin resultado...');

    try {
      const now = new Date();
      const twoHoursAgo = new Date(
        now.getTime() - HOURS_TO_REMIND_RESULT * 60 * 60 * 1000,
      );

      const overdue = await this.prisma.masterMatch.findMany({
        where: {
          status: 'pending',
          scheduled_date: { not: null, lte: twoHoursAgo },
        },
        include: { player1: true, player2: true },
      });

      // Filtro en JS (igual que ChallengesCronService.handleNotConfirmed):
      // Prisma requiere Prisma.DbNull/JsonNull para comparar campos Json?
      // contra NULL, así que es más simple filtrar aquí.
      const pending = overdue.filter(
        (m) => m.player1_result === null && m.player2_result === null,
      );

      for (const match of pending) {
        const formattedDate = match.scheduled_date.toLocaleString('es-CL', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'America/Santiago',
        });

        const remind = (rivalName: string) =>
          `🏆 *Master CTG*\n\n` +
          `⏰ *Recordatorio de resultado*\n\n` +
          `Tu partido vs ${rivalName} ya debería estar jugado (agendado para ${formattedDate}) y aún no se ha registrado el resultado.\n\n` +
          `Ingresa el resultado en la app para no atrasar el torneo.`;

        void this.sendWsp(match.player1.phone, remind(match.player2.name));
        void this.sendWsp(match.player2.phone, remind(match.player1.name));

        this.logger.warn(
          `⏱️  Recordatorio enviado: ${match.player1.name} vs ${match.player2.name}`,
        );
      }

      this.logger.log(
        `✅ Recordatorios de resultado Master enviados: ${pending.length}`,
      );
    } catch (error) {
      this.logger.error(
        '❌ Error verificando partidos Master sin resultado:',
        error,
      );
    }
  }
}
