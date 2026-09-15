/**
 * Prueba aislada de WhatsApp: levanta SOLO el servicio (sin Nest, sin base de
 * datos, sin crons) contra el WhatsApp Web de hoy, dibuja el QR en la terminal
 * y dice si el cliente llega a `ready`.
 *
 * Para qué: whatsapp-web.js se engancha a piezas internas de WhatsApp Web, y
 * cuando WhatsApp las cambia la librería autentica pero nunca queda lista — sin
 * ningún error en el log. Pasó en septiembre de 2026 con la 1.34.6 contra
 * WhatsApp Web 2.3000.1047523314 (se arregló subiendo a la 1.34.7). Antes de
 * desplegar una versión nueva de la librería, esto confirma que funciona.
 *
 *   npx ts-node scripts/probar-whatsapp.ts
 *
 * Escanear con un WhatsApp PERSONAL, no el del club, para no tocar la sesión
 * del servidor. Al terminar desvincula el dispositivo y borra la sesión.
 * Si puppeteer no encuentra Chromium, pasar PUPPETEER_EXECUTABLE_PATH.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SESION = fs.mkdtempSync(path.join(os.tmpdir(), 'ctg-probar-whatsapp-'));
process.env.WHATSAPP_ENABLED = 'true';
process.env.WHATSAPP_SESSION_PATH = SESION;
process.env.WHATSAPP_READY_WATCHDOG_MS = '120000';
// El correo no participa, pero se apaga por si algo lo tocara.
process.env.EMAIL_ENABLED = 'false';

/* eslint-disable @typescript-eslint/no-require-imports */
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const version: string = require('whatsapp-web.js/package.json').version;
/* eslint-enable @typescript-eslint/no-require-imports */

const LIMITE_MS = 4 * 60 * 1000;
let cliente: any = null;
let terminado = false;

async function terminar(codigo: number, mensaje: string) {
  if (terminado) return;
  terminado = true;
  console.log('\n' + mensaje);
  try {
    if (codigo === 0 && cliente) {
      await cliente.logout();
      console.log('🔌 Dispositivo de prueba desvinculado del teléfono.');
    }
    if (cliente) await cliente.destroy();
  } catch {
    // al cerrar da igual si ya estaba cerrado
  }
  fs.rmSync(SESION, { recursive: true, force: true });
  process.exit(codigo);
}

// Se engancha a los eventos del cliente sin modificar el servicio.
const emitOriginal = Client.prototype.emit;
Client.prototype.emit = function (evento: string, ...args: unknown[]) {
  cliente = this;
  const resultado = emitOriginal.call(this, evento, ...args);
  if (evento === 'qr') {
    console.log('\n📱 Escanea: WhatsApp → Dispositivos vinculados → Vincular dispositivo\n');
    qrcode.generate(args[0], { small: true });
  }
  if (evento === 'ready') {
    setTimeout(
      () => void terminar(0, `✅ READY con whatsapp-web.js ${version}: funciona con el WhatsApp Web de hoy.`),
      3000,
    );
  }
  return resultado;
};

// Import después de fijar las variables: el servicio las lee al inicializar.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { whatsappService } = require('../src/notifications/whatsapp.service');

console.log(`🧪 Probando whatsapp-web.js ${version} (límite ${LIMITE_MS / 60000} min)\n`);
void whatsappService.initialize();

setTimeout(
  () => void terminar(1, `❌ Sin 'ready' en ${LIMITE_MS / 60000} min con whatsapp-web.js ${version}. Revisa las líneas 🧩 y 🩺.`),
  LIMITE_MS,
);
process.on('SIGINT', () => void terminar(1, '⏹️ Prueba cancelada.'));
