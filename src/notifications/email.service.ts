import { Resend } from 'resend';

export class EmailService {
  private _resend: Resend | null = null;

  // Lazy init: el cliente se crea recién al primer envío, no al importar el módulo.
  // Así los tests que importan constantes de esta cadena no necesitan RESEND_API_KEY.
  private get resend(): Resend {
    if (!this._resend) {
      this._resend = new Resend(process.env.RESEND_API_KEY);
    }
    return this._resend;
  }

  private fromEmail = 'CTG Escalerilla <escalerilla@clubdetenisgraneros.cl>';

  /**
   * Los correos salen solo en producción, o cuando se piden explícitamente con
   * EMAIL_ENABLED=true.
   *
   * Sin esta guarda, cualquier script corrido a mano contra la base de dev le
   * manda correos DE VERDAD a los socios: Prisma carga `.env` dentro de
   * `process.env` al inicializarse, y ese archivo trae la API key real de
   * Resend aunque el DATABASE_URL apunte a dev. Ya pasó una vez — una prueba
   * end-to-end avisó a tres socios de desafíos que no existían.
   *
   * Mismo patrón que WHATSAPP_ENABLED en whatsapp.service.ts.
   */
  private get enabled(): boolean {
    if (process.env.EMAIL_ENABLED === 'true') return true;
    if (process.env.EMAIL_ENABLED === 'false') return false;
    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd) {
      console.log(
        '📭 Email desactivado (NODE_ENV != production). Usa EMAIL_ENABLED=true para forzarlo.',
      );
    }
    return isProd;
  }

  async sendChallengeNotification(
    challengerName: string,
    challengedName: string,
    challengedEmail: string,
  ) {
    if (!this.enabled) return;
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: challengedEmail,
        subject: '🎾 Nuevo Desafío en la Escalerilla',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #1e5128 0%, #4e9f3d 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">🎾 Nuevo Desafío</h1>
            </div>
            <div style="background: white; padding: 30px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                Hola <strong>${challengedName}</strong>,
              </p>
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                <strong>${challengerName}</strong> te ha desafiado en la escalerilla.
              </p>
              <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px;">
                <p style="margin: 0; color: #856404; font-weight: bold;">
                  ⏰ Tienes 24 horas para aceptar o rechazar el desafío
                </p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL}/fixture" 
                   style="display: inline-block; background: #4e9f3d; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                  Ver Desafío
                </a>
              </div>
              <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                Club de Tenis Graneros<br>
                Escalerilla 2026
              </p>
            </div>
          </div>
        `,
      });
      console.log(`✅ Email enviado a ${challengedEmail}`);
      return true;
    } catch (error) {
      console.error('❌ Error al enviar email:', error);
      return false;
    }
  }

  async sendAcceptedNotification(
    challengerName: string,
    challengedName: string,
    challengerEmail: string,
  ) {
    if (!this.enabled) return;
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: challengerEmail,
        subject: '✅ Tu desafío fue aceptado',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">✅ ¡Desafío Aceptado!</h1>
            </div>
            <div style="background: white; padding: 30px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                Hola <strong>${challengerName}</strong>,
              </p>
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                <strong>${challengedName}</strong> aceptó tu desafío. 🎾
              </p>
              <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 5px;">
                <p style="margin: 0; color: #065f46; font-weight: bold;">
                  ⏰ Tienen 5 días para jugar el partido
                </p>
              </div>
              <p style="font-size: 16px; color: #333;">
                Coordinen entre ustedes y no olviden registrar el resultado cuando terminen.
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL}/fixture" 
                   style="display: inline-block; background: #10b981; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                  Ver Partidos
                </a>
              </div>
              <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                Club de Tenis Graneros<br>
                Escalerilla 2026
              </p>
            </div>
          </div>
        `,
      });
      return true;
    } catch (error) {
      console.error(
        '❌ Error al enviar email:',
        JSON.stringify(error, null, 2),
      );
      console.error('❌ Message:', error?.message);
      console.error('❌ Name:', error?.name);
      return false;
    }
  }

  async sendRejectedNotification(
    challengerName: string,
    challengedName: string,
    challengerEmail: string,
  ) {
    if (!this.enabled) return;
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: challengerEmail,
        subject: '🎾 Desafío Rechazado - Subiste en la escalerilla',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #1e5128 0%, #4e9f3d 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">🎾 Desafío Rechazado</h1>
            </div>
            <div style="background: white; padding: 30px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                Hola <strong>${challengerName}</strong>,
              </p>
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                <strong>${challengedName}</strong> rechazó tu desafío.
              </p>
              <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 5px;">
                <p style="margin: 0; color: #065f46; font-weight: bold;">
                  🏆 ¡Ganas por W.O. y subes en la escalerilla!
                </p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL}" 
                   style="display: inline-block; background: #4e9f3d; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                  Ver Escalerilla
                </a>
              </div>
              <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                Club de Tenis Graneros<br>
                Escalerilla 2026
              </p>
            </div>
          </div>
        `,
      });
      return true;
    } catch (error) {
      console.error('❌ Error al enviar email:', error);
      return false;
    }
  }

  async sendResultConfirmedNotification(
    playerName: string,
    opponentName: string,
    playerEmail: string,
    score: string,
    won: boolean,
    newPosition: number,
  ) {
    if (!this.enabled) return;
    try {
      const subject = won
        ? '🏆 ¡Ganaste el partido!'
        : '🎾 Resultado confirmado';

      await this.resend.emails.send({
        from: this.fromEmail,
        to: playerEmail,
        subject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, ${won ? '#10b981 0%, #059669' : '#1e5128 0%, #4e9f3d'} 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">${won ? '🏆 ¡Ganaste!' : '🎾 Resultado Confirmado'}</h1>
            </div>
            <div style="background: white; padding: 30px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                Hola <strong>${playerName}</strong>,
              </p>
              <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                ${
                  won
                    ? `¡Felicidades! Ganaste el partido contra <strong>${opponentName}</strong>.`
                    : `El resultado del partido contra <strong>${opponentName}</strong> ha sido confirmado.`
                }
              </p>
              <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Resultado</p>
                <p style="margin: 0; font-size: 24px; font-weight: bold; color: #1e5128;">${score}</p>
              </div>
              <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 5px;">
                <p style="margin: 0; color: #065f46; font-weight: bold;">
                  📊 Nueva posición en la escalerilla: #${newPosition}
                </p>
              </div>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL}" 
                   style="display: inline-block; background: #4e9f3d; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                  Ver Escalerilla
                </a>
              </div>
              <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                Club de Tenis Graneros<br>
                Escalerilla 2026
              </p>
            </div>
          </div>
        `,
      });
      return true;
    } catch (error) {
      console.error('❌ Error al enviar email:', error);
      return false;
    }
  }
}

export const emailService = new EmailService();
