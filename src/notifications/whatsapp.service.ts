import { Client, LocalAuth } from 'whatsapp-web.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Espera tras `initialize()` antes de volcar un diagnóstico si el cliente no
 * llegó a `ready`. Configurable para poder probarlo en local sin esperar.
 */
const READY_WATCHDOG_MS = Number(process.env.WHATSAPP_READY_WATCHDOG_MS) || 90_000;

export class WhatsAppService {
  private client: Client;
  private ready = false;
  private pageDiagnosticsAttached = false;

  async initialize() {
    if (process.env.WHATSAPP_ENABLED !== 'true') {
      console.log('⚠️ WhatsApp desactivado (WHATSAPP_ENABLED != true)');
      return;
    }

    console.log('🔄 Inicializando WhatsApp Bot...');

    const dataPath = process.env.WHATSAPP_SESSION_PATH || '.wwebjs_auth';

    const lockFiles = [
      path.join(dataPath, 'SingletonLock'),
      path.join(dataPath, 'SingletonCookie'),
      path.join(dataPath, 'SingletonSocket'),
    ];

    for (const lockFile of lockFiles) {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        console.log(`🧹 Eliminado: ${lockFile}`);
      }
    }

    const findAndDeleteLocks = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findAndDeleteLocks(fullPath);
        } else if (
          ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].includes(
            entry.name,
          )
        ) {
          fs.unlinkSync(fullPath);
          console.log(`🧹 Eliminado: ${fullPath}`);
        }
      }
    };

    findAndDeleteLocks(dataPath);

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath,
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--single-process',
        ],
      },
    });

    this.client.on('qr', (qr) => {
      console.log(
        '\n╔════════════════════════════════════════════════════════════╗',
      );
      console.log(
        '║       GENERA TU QR EN https://qr.io                       ║',
      );
      console.log(
        '╚════════════════════════════════════════════════════════════╝\n',
      );
      console.log('📋 COPIA ESTE TEXTO COMPLETO:\n');
      console.log(
        '┌─────────────────────────────────────────────────────────┐',
      );
      console.log(qr);
      console.log(
        '└─────────────────────────────────────────────────────────┘\n',
      );
      console.log('👉 PASOS:');
      console.log('   1. Ve a https://qr.io');
      console.log('   2. Pega el texto de arriba en el campo "Text"');
      console.log('   3. Genera el QR');
      console.log('   4. Escanéalo con WhatsApp en tu teléfono\n');
    });

    this.client.on('ready', () => {
      console.log('✅ WhatsApp conectado! 🎉');
      this.ready = true;
      // La versión de WhatsApp Web con la que SÍ funcionó: la referencia para
      // comparar la próxima vez que deje de llegar a `ready`.
      void this.client
        .getWWebVersion()
        .then((v) => console.log(`📦 WhatsApp Web ${v}`))
        .catch(() => undefined);
    });

    this.client.on('authenticated', () => {
      console.log('✅ Autenticado correctamente');
      // El paso que sigue (inyectar los módulos de WhatsApp Web y emitir
      // `ready`) corre DENTRO de la página de Chromium: la librería lo registra
      // con `exposeFunction`, así que si falla, el error vuelve a la página y
      // nunca a Node. Sin estos listeners, "autenticado y después nada" no deja
      // rastro en los logs. Se enganchan acá porque `emit` es síncrono y el
      // fallo ocurre después, tras varios `await`.
      this.attachPageDiagnostics();
    });

    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ WhatsApp cargando: ${percent}% ${message ?? ''}`);
    });

    this.client.on('change_state', (state) => {
      console.log(`🔁 WhatsApp cambió de estado: ${state}`);
    });

    this.client.on('auth_failure', () => {
      console.log('❌ Error de autenticación');
      this.ready = false;
    });

    this.client.on('disconnected', (reason) => {
      console.log('❌ Desconectado:', reason);
      this.ready = false;
    });

    try {
      await this.client.initialize();
      this.attachPageDiagnostics();
      this.scheduleReadyWatchdog();
    } catch (error) {
      console.error('❌ Error inicializando WhatsApp:', error);
    }
  }

  /** Registra en el log de Node los errores que ocurren dentro de la página. */
  private attachPageDiagnostics() {
    const page = this.client?.pupPage;
    if (!page || this.pageDiagnosticsAttached) return;
    this.pageDiagnosticsAttached = true;
    page.on('pageerror', (error: unknown) => {
      const detalle = error instanceof Error ? error.message : String(error);
      console.error('🧩 WhatsApp error en la página:', detalle);
    });
    // Los errores de consola solo interesan mientras no está listo: una vez
    // conectado, WhatsApp Web emite errores de red normales (400 de recursos)
    // que llenarían el log todo el día sin decir nada útil.
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !this.ready) {
        console.error('🧩 WhatsApp consola (error):', msg.text().slice(0, 500));
      }
    });
  }

  /**
   * Si pasado un rato el cliente no llegó a `ready`, deja una foto de su estado:
   * versión de WhatsApp Web y de Chromium, y qué piezas internas existen. Es lo
   * que distingue una librería incompatible con la versión actual de WhatsApp
   * Web de una sesión dañada en disco.
   */
  private scheduleReadyWatchdog() {
    const timer = setTimeout(() => {
      if (this.ready) return;
      void this.logReadinessDiagnostics();
    }, READY_WATCHDOG_MS);
    timer.unref?.();
  }

  private async logReadinessDiagnostics() {
    const segundos = Math.round(READY_WATCHDOG_MS / 1000);
    console.error(`🩺 WhatsApp sigue sin 'ready' ${segundos}s después de inicializar. Diagnóstico:`);
    try {
      const libVersion: string = require('whatsapp-web.js/package.json').version;
      const browserVersion = await this.client.pupBrowser?.version();
      const page = await this.client.pupPage?.evaluate(() => {
        const w = window as any;
        return {
          url: location.href,
          waWebVersion: w.Debug?.VERSION ?? null,
          authStore: typeof w.AuthStore,
          appState: w.AuthStore?.AppState?.state ?? null,
          hasSynced: w.AuthStore?.AppState?.hasSynced ?? null,
          store: typeof w.Store,
          wwebjs: typeof w.WWebJS,
          requireFn: typeof w.require,
        };
      });
      console.error('🩺', JSON.stringify({ libVersion, browserVersion, ...page }));
    } catch (error) {
      console.error('🩺 No se pudo leer el estado de la página:', (error as Error)?.message ?? error);
    }
  }

  private formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');

    if (cleaned.startsWith('+')) {
      cleaned = cleaned.substring(1);
    }

    if (!cleaned.startsWith('56')) {
      if (cleaned.startsWith('9')) {
        cleaned = '56' + cleaned;
      } else {
        console.warn(`⚠️ Número sospechoso: ${phone} -> ${cleaned}`);
      }
    }

    console.log(`📱 Formateando: ${phone} -> ${cleaned}@c.us`);
    return cleaned + '@c.us';
  }

  async sendMessage(phone: string, message: string) {
    if (!this.ready) {
      console.log('⚠️ WhatsApp no está listo');
      return false;
    }

    try {
      const chatId = this.formatPhoneNumber(phone);

      const numberExists = await this.client.isRegisteredUser(chatId);

      if (!numberExists) {
        console.error(
          `❌ El número ${phone} (${chatId}) NO está registrado en WhatsApp`,
        );
        return false;
      }

      await this.client.sendMessage(chatId, message);
      console.log(`✅ Mensaje enviado exitosamente a ${phone} (${chatId})`);
      return true;
    } catch (error) {
      console.error(
        `❌ Error enviando mensaje a ${phone}:`,
        error.message || error,
      );
      return false;
    }
  }

  // ─── Grupos ───────────────────────────────────────────────────────────────

  async getGroups() {
    if (!this.ready) {
      console.log('⚠️ WhatsApp no está listo');
      return [];
    }

    try {
      const chats = await this.client.getChats();
      const groups = chats
        .filter((chat) => chat.isGroup)
        .map((chat) => ({
          id: chat.id._serialized,
          name: chat.name,
        }));

      console.log(`📋 Grupos encontrados: ${groups.length}`);
      groups.forEach((g) => console.log(`  - ${g.name}: ${g.id}`));

      return groups;
    } catch (error) {
      console.error('❌ Error obteniendo grupos:', error.message || error);
      return [];
    }
  }

  async sendGroupMessage(groupId: string, message: string) {
    if (!this.ready) {
      console.log('⚠️ WhatsApp no está listo');
      return false;
    }

    try {
      await this.client.sendMessage(groupId, message);
      console.log(`✅ Mensaje enviado al grupo ${groupId}`);
      return true;
    } catch (error) {
      console.error(
        `❌ Error enviando mensaje al grupo:`,
        error.message || error,
      );
      return false;
    }
  }

  async sendResultToGroup(
    challengerName: string,
    challengedName: string,
    winnerName: string,
    score: string,
    newWinnerPosition: number,
    newLoserPosition: number,
  ) {
    const groupId = process.env.WHATSAPP_GROUP_ID;
    if (!groupId) {
      console.log(
        '⚠️ WHATSAPP_GROUP_ID no configurado, omitiendo notificación al grupo',
      );
      return false;
    }

    const loserName =
      winnerName === challengerName ? challengedName : challengerName;

    return this.sendGroupMessage(
      groupId,
      `🎾 *Club de Tenis Graneros - Resultado*\n\n` +
        `🏆 *${winnerName}* venció a *${loserName}*\n` +
        `📊 Score: *${score}*\n\n` +
        `📈 Nuevas posiciones:\n` +
        `  • ${winnerName}: #${newWinnerPosition}\n` +
        `  • ${loserName}: #${newLoserPosition}`,
    );
  }

  // ─── Notificaciones existentes ────────────────────────────────────────────

  async sendChallengeNotification(
    challengerName: string,
    challengedName: string,
    challengedPhone: string,
  ) {
    const appUrl =
      process.env.FRONTEND_URL || 'https://escalerilla.clubdetenisgraneros.cl/';

    return this.sendMessage(
      challengedPhone,
      `🎾 *Club de Tenis Graneros*\n\n` +
        `¡Tienes un nuevo desafío!\n` +
        `*${challengerName}* te ha desafiado.\n\n` +
        `⏰ Tienes 24 horas para responder.\n\n` +
        `👉 Ver mis desafíos:\n` +
        `${appUrl}/fixture`,
    );
  }

  async sendAcceptedNotification(
    challengerName: string,
    challengedName: string,
    challengerPhone: string,
  ) {
    const appUrl =
      process.env.FRONTEND_URL || 'https://escalerilla.clubdetenisgraneros.cl/';

    return this.sendMessage(
      challengerPhone,
      `🎾 *Club de Tenis Graneros*\n\n` +
        `✅ *${challengedName}* aceptó tu desafío!\n\n` +
        `⏰ Tienen 5 días para jugar.\n\n` +
        `👉 Coordinar partido:\n` +
        `${appUrl}/fixture`,
    );
  }

  async sendRejectedNotification(
    challengerName: string,
    challengedName: string,
    challengerPhone: string,
  ) {
    const appUrl =
      process.env.FRONTEND_URL || 'https://escalerilla.clubdetenisgraneros.cl/';

    return this.sendMessage(
      challengerPhone,
      `🎾 *Club de Tenis Graneros*\n\n` +
        `❌ ${challengedName} rechazó tu desafío.\n\n` +
        `🏆 Ganas por W.O. y subes en la escalerilla!\n\n` +
        `👉 Ver escalerilla:\n` +
        `${appUrl}`,
    );
  }

  async sendDeadlineReminder(
    playerName: string,
    opponentName: string,
    playerPhone: string,
    hoursLeft: number,
  ) {
    const appUrl =
      process.env.FRONTEND_URL || 'https://escalerilla.clubdetenisgraneros.cl/';

    return this.sendMessage(
      playerPhone,
      `🎾 *Club de Tenis Graneros*\n\n` +
        `⏰ *RECORDATORIO*\n\n` +
        `Tu partido contra *${opponentName}* vence en ${hoursLeft} horas.\n\n` +
        `👉 Reportar resultado:\n` +
        `${appUrl}/fixture`,
    );
  }

  async sendPasswordResetLink(
    playerName: string,
    playerPhone: string,
    resetLink: string,
  ) {
    return this.sendMessage(
      playerPhone,
      `🎾 *Club de Tenis Graneros*\n\n` +
        `Hola *${playerName}*\n\n` +
        `Solicitud de cambio de contraseña.\n\n` +
        `👉 Cambiar contraseña:\n` +
        `${resetLink}\n\n` +
        `⏰ Expira en 1 hora.`,
    );
  }

  isReady() {
    return this.ready;
  }
}

export const whatsappService = new WhatsAppService();
