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

  it('un script no envía: no está marcado como servidor', async () => {
    delete process.env.CTG_SERVER_PROCESS;
    delete process.env.EMAIL_ENABLED;

    await service.sendChallengeNotification('Ana', 'Beto', 'beto@ejemplo.cl');

    expect(sent).toHaveLength(0);
  });

  it('el servidor sí envía', async () => {
    process.env.CTG_SERVER_PROCESS = 'true';
    delete process.env.EMAIL_ENABLED;

    await service.sendChallengeNotification('Ana', 'Beto', 'beto@ejemplo.cl');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'beto@ejemplo.cl' });
  });

  it('no depende de NODE_ENV: el servidor envía aunque no esté seteada', async () => {
    // Railway inyecta las variables directamente y NODE_ENV puede no estar.
    // Atarlo a NODE_ENV apagaría los correos en producción sin aviso.
    delete process.env.NODE_ENV;
    process.env.CTG_SERVER_PROCESS = 'true';
    delete process.env.EMAIL_ENABLED;

    await service.sendChallengeNotification('Ana', 'Beto', 'beto@ejemplo.cl');

    expect(sent).toHaveLength(1);
  });

  it('EMAIL_ENABLED=true fuerza el envío desde un script', async () => {
    delete process.env.CTG_SERVER_PROCESS;
    process.env.EMAIL_ENABLED = 'true';

    await service.sendChallengeNotification('Ana', 'Beto', 'beto@ejemplo.cl');

    expect(sent).toHaveLength(1);
  });

  it('EMAIL_ENABLED=false corta el envío incluso en el servidor', async () => {
    process.env.CTG_SERVER_PROCESS = 'true';
    process.env.EMAIL_ENABLED = 'false';

    await service.sendChallengeNotification('Ana', 'Beto', 'beto@ejemplo.cl');

    expect(sent).toHaveLength(0);
  });

  it('la guarda cubre los cuatro tipos de correo, no solo el de desafío', async () => {
    delete process.env.CTG_SERVER_PROCESS;
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
