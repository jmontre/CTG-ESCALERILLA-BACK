import { ChallengesService } from './challenges.service';
import { whatsappService } from '../notifications/whatsapp.service';

jest.mock('../notifications/whatsapp.service', () => ({
  whatsappService: {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sendGroupMessage: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../notifications/email.service', () => ({ emailService: {} }));

/** Deja correr los notifyAsync (fire-and-forget) antes de aserciones. */
const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

/**
 * Simula dos requests concurrentes a POST /challenges/:id/result:
 * ambas leen la MISMA foto del desafío (status 'accepted') porque la primera
 * todavía no terminó de procesar. Solo el claim atómico puede frenar a la segunda.
 */
function build(opts: {
  challengerResult?: { winnerId: string; score: string } | null;
  challengedResult?: { winnerId: string; score: string } | null;
}) {
  const stored: any = {
    id: 'c1',
    challenger_id: 'p1',
    challenged_id: 'p2',
    status: 'accepted',
    challenger_result: opts.challengerResult ?? null,
    challenged_result: opts.challengedResult ?? null,
    first_result_at: new Date(),
    challenger: { id: 'p1', name: 'Uno', phone: null, position: 46 },
    challenged: { id: 'p2', name: 'Dos', phone: null, position: 40 },
  };
  // Estado real de la fila en DB (lo que ve el UPDATE ... WHERE status = ...).
  let dbStatus = 'accepted';

  const prisma: any = {
    challenge: {
      // Foto pre-claim: todas las requests leyeron la fila cuando todavía
      // estaba 'accepted' (por eso el status va fijo, aunque la DB ya cambió).
      findUnique: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ ...stored, status: 'accepted' }),
        ),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(stored, data);
        return Promise.resolve({ ...stored });
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
        if (where.status && where.status !== dbStatus)
          return Promise.resolve({ count: 0 });
        if (data.status) dbStatus = data.status;
        return Promise.resolve({ count: 1 });
      }),
    },
    reservation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    player: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            where.id === 'p1'
              ? { id: 'p1', name: 'Uno', position: 40, phone: null }
              : { id: 'p2', name: 'Dos', position: 41, phone: null },
          ),
        ),
    },
  };

  const rules = {
    processWin: jest.fn().mockResolvedValue(undefined),
    applyPostMatchStatus: jest.fn().mockResolvedValue(undefined),
    updateStats: jest.fn().mockResolvedValue(undefined),
  };
  const appLogger = {
    challengeResult: jest.fn(),
    challengeDisputed: jest.fn(),
  };
  const notificationsService = {
    create: jest.fn().mockResolvedValue(undefined),
    notifyMatchResult: jest.fn().mockResolvedValue(undefined),
  };
  const achievements = {
    evaluateAfterChallenge: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new ChallengesService(
      prisma,
      rules as never,
      appLogger as never,
      notificationsService as never,
      achievements as never,
    ),
    prisma,
    rules,
    appLogger,
    notificationsService,
  };
}

describe('ChallengesService.submitResult — doble procesamiento', () => {
  const win = { winnerId: 'p1', score: '6-3, 6-1' };

  beforeEach(() => {
    process.env.WHATSAPP_GROUP_ID = 'grupo@g.us';
    jest.clearAllMocks();
  });

  it('procesa el resultado UNA sola vez aunque lleguen requests repetidas', async () => {
    const { service, rules, appLogger } = build({ challengerResult: win });

    await service.submitResult('c1', 'p2', win);
    await service.submitResult('c1', 'p2', win);
    await service.submitResult('c1', 'p2', win);
    await flush();

    expect(rules.processWin).toHaveBeenCalledTimes(1);
    expect(rules.updateStats).toHaveBeenCalledTimes(1);
    expect(rules.applyPostMatchStatus).toHaveBeenCalledTimes(1);
    expect(appLogger.challengeResult).toHaveBeenCalledTimes(1);
  });

  it('procesa una sola vez con las requests realmente en paralelo', async () => {
    const { service, rules } = build({ challengerResult: win });

    await Promise.all([
      service.submitResult('c1', 'p2', win),
      service.submitResult('c1', 'p2', win),
      service.submitResult('c1', 'p2', win),
      service.submitResult('c1', 'p2', win),
    ]);
    await flush();

    expect(rules.processWin).toHaveBeenCalledTimes(1);
    expect(rules.updateStats).toHaveBeenCalledTimes(1);
  });

  it('notifica el resultado al grupo y a los jugadores una sola vez', async () => {
    const { service, notificationsService } = build({ challengerResult: win });

    await service.submitResult('c1', 'p2', win);
    await service.submitResult('c1', 'p2', win);
    await flush();

    expect(whatsappService.sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(notificationsService.notifyMatchResult).toHaveBeenCalledTimes(1);
  });

  it('marca la disputa una sola vez cuando los resultados no coinciden', async () => {
    const { service, appLogger } = build({ challengerResult: win });

    await service.submitResult('c1', 'p2', {
      winnerId: 'p2',
      score: '6-4, 6-4',
    });
    await service.submitResult('c1', 'p2', {
      winnerId: 'p2',
      score: '6-4, 6-4',
    });
    await flush();

    expect(appLogger.challengeDisputed).toHaveBeenCalledTimes(1);
  });

  it('no spamea al rival si un jugador reenvía su propio resultado', async () => {
    const { service, notificationsService } = build({});

    await service.submitResult('c1', 'p1', win);
    await service.submitResult('c1', 'p1', win);
    await service.submitResult('c1', 'p1', win);
    await flush();

    expect(
      notificationsService.create.mock.calls.filter(
        (c) => (c[1] as { type: string }).type === 'result_submitted',
      ),
    ).toHaveLength(1);
  });
});
