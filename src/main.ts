import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { whatsappService } from './notifications/whatsapp.service';
import { ChileLogger } from './common/chile-logger';
import * as bodyParser from 'body-parser';
import helmet from 'helmet';

/**
 * Marca que este proceso es el servidor. `EmailService` lo exige para enviar:
 * los scripts sueltos nunca pasan por acá, así que no pueden mandarle correos
 * a los socios aunque hereden la API key real desde `.env` (Prisma lo carga
 * dentro de process.env al inicializarse).
 */
process.env.CTG_SERVER_PROCESS = 'true';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new ChileLogger(),
  });

  // Detrás de Cloudflare + Railway: req.ip es la IP real del usuario, no del proxy.
  // Sin esto el throttler ve a todos como la misma IP y el rate limiting no funciona.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Aumentar límite para subida de imágenes en base64
  app.use(bodyParser.json({ limit: '10mb' }));

  const port = process.env.PORT || 3000;

  // Previews de Vercel: solo los del proyecto propio, no cualquier *.vercel.app.
  // El sufijo del equipo (-jmontres-projects.vercel.app) es lo que no puede
  // falsificar un tercero: los slugs de equipo en Vercel son únicos. Si el
  // proyecto o el equipo se renombran, ajustar las env vars sin tocar código.
  const vercelPreviewPrefix =
    process.env.VERCEL_PREVIEW_PREFIX || 'ctg-escalerilla-front';
  const vercelPreviewSuffix =
    process.env.VERCEL_PREVIEW_SUFFIX || '-jmontres-projects.vercel.app';
  const isOwnVercelPreview = (origin: string) =>
    origin.startsWith(`https://${vercelPreviewPrefix}`) &&
    origin.endsWith(vercelPreviewSuffix);

  app.enableCors({
    origin: (origin, callback) => {
      const allowed = [
        'http://localhost:3001',
        'http://localhost:3000',
        'https://reservas.clubdetenisgraneros.cl',
        'https://escalerilla.clubdetenisgraneros.cl',
        process.env.FRONTEND_URL,
      ].filter(Boolean);
      // Permitir requests sin origin (mobile apps, Postman, etc.)
      if (!origin || allowed.includes(origin) || isOwnVercelPreview(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origen no permitido: ${origin}`));
      }
    },
    credentials: true,
  });

  console.log('🔄 Inicializando WhatsApp Bot...');
  await whatsappService.initialize();

  await app.listen(port);
  console.log(`🚀 Backend corriendo en puerto ${port}`);
  console.log('📱 Test WhatsApp: POST /test/whatsapp');
}

bootstrap();
