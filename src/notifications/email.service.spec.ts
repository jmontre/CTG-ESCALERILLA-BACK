import { EmailService } from './email.service';

/**
 * La guarda de envío es lo único que separa un script corrido a mano contra la
 * base de dev de mandarle correos de verdad a los socios: Prisma carga `.env`
 * dentro de `process.env` al inicializarse, y ese archivo trae la API key real
 * de Resend aunque el DATABASE_URL apunte a dev.
 */
describe('EmailService — guarda de envío', () => {
  const originalEnv = { ...process.env };
  let sent: unknown[];
  let service: EmailService;

  beforeEach(() => {
    sent = [];
    service = new EmailService();
    // Reemplaza el cliente de Resend para no salir a la red en los tests.
    Object.defineProperty(service, 'resend', {
      get: () => ({
        emails: {
          send: (payload: unknown) => {
            sent.push(payload);
            return Promise.resolve({ data: { id: 'fake' }, error: null });
          },
        },
      }),
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('no envía fuera de producción', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EMAIL_ENABLED;

    await service.sendChallengeNotification('Ana', 'Beto', 'beto@ejemplo.cl');

    expect(sent).toHaveLength(0);
  });

  it('envía en producción', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.EMAIL_ENABLED;

    await service.sendChallengeNotification('Ana', 'Beto', 'beto@ejemplo.cl');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'beto@ejemplo.cl' });
  });

  it('EMAIL_ENABLED=true fuerza el envío fuera de producción', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_ENABLED = 'true';

    await service.sendChallengeNotification('Ana', 'Beto', 'beto@ejemplo.cl');

    expect(sent).toHaveLength(1);
  });

  it('EMAIL_ENABLED=false corta el envío incluso en producción', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_ENABLED = 'false';

    await service.sendChallengeNotification('Ana', 'Beto', 'beto@ejemplo.cl');

    expect(sent).toHaveLength(0);
  });

  it('la guarda cubre los cuatro tipos de correo, no solo el de desafío', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EMAIL_ENABLED;

    await service.sendChallengeNotification('Ana', 'Beto', 'beto@ejemplo.cl');
    await service.sendAcceptedNotification('Ana', 'Beto', 'ana@ejemplo.cl');
    await service.sendRejectedNotification('Ana', 'Beto', 'ana@ejemplo.cl');
    await service.sendResultConfirmedNotification(
      'Ana',
      'Beto',
      'ana@ejemplo.cl',
      '6-4, 6-3',
      true,
      3,
    );

    expect(sent).toHaveLength(0);
  });
});
