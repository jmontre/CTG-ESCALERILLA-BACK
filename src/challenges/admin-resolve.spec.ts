import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminChallengesService } from './admin-challenges.service';
import { ChallengeRulesService } from './challenge-rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../achievements/achievements.service';
import { whatsappService } from '../notifications/whatsapp.service';

jest.mock('../notifications/whatsapp.service', () => ({
  whatsappService: { sendMessage: jest.fn(), sendGroupMessage: jest.fn() },
}));

/**
 * Resolver un desafío desde el panel tiene que aplicarse UNA sola vez.
 *
 * En producción pasó 4 veces en una semana (09, 11 y 15-sep): la resolución
 * tarda varios segundos, el admin volvía a apretar el botón, y como
 * `resolveChallenge` no reclamaba la transición, la segunda petición volvía a
 * sumar victoria y derrota, a dar inmunidad y a avisar al grupo. Claudio
 * Pinilla quedó 4-0 habiendo jugado 3.
 */
describe('AdminChallengesService.resolveChallenge — una sola vez', () => {
  const PINEDA = 'p-pineda';
  const PINILLA = 'p-pinilla';

  const base = {
    id: 'c1',
    challenger_id: PINEDA,
    challenged_id: PINILLA,
    winner_id: null as string | null,
    final_score: null as string | null,
    played_at: null,
    challenger: { id: PINEDA, name: 'Claudio Pineda', position: 5 },
    challenged: { id: PINILLA, name: 'Claudio Pinilla', position: 2 },
  };

  async function build(challenge: any, claimCount = 1) {
    const prisma: any = {
      challenge: {
        findUnique: jest.fn().mockResolvedValue(challenge),
        updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
        update: jest.fn().mockResolvedValue(challenge),
      },
      reservation: { updateMany: jest.fn() },
    };
    const rules = {
      processWin: jest.fn(),
      applyPostMatchStatus: jest.fn(),
      updateStats: jest.fn(),
    };
    const notifications = { notifyMatchResult: jest.fn(), create: jest.fn() };
    const achievements = { evaluateAfterChallenge: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AdminChallengesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChallengeRulesService, useValue: rules },
        { provide: NotificationsService, useValue: notifications },
        { provide: AchievementsService, useValue: achievements },
      ],
    }).compile();
    return {
      service: module.get(AdminChallengesService),
      prisma,
      rules,
      notifications,
      achievements,
    };
  }

  const nadaSeAplico = (x: any) => {
    expect(x.rules.processWin).not.toHaveBeenCalled();
    expect(x.rules.applyPostMatchStatus).not.toHaveBeenCalled();
    expect(x.rules.updateStats).not.toHaveBeenCalled();
    expect(x.achievements.evaluateAfterChallenge).not.toHaveBeenCalled();
    expect(x.notifications.notifyMatchResult).not.toHaveBeenCalled();
    expect(whatsappService.sendGroupMessage).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_GROUP_ID = '123@g.us';
  });
  afterAll(() => {
    delete process.env.WHATSAPP_GROUP_ID;
  });

  it('reclama la transición ANTES de mover estadísticas o posiciones', async () => {
    const x = await build({ ...base, status: 'accepted' });

    await x.service.resolveChallenge('c1', PINILLA, '6-3, 6-7, 10-4');

    const claim = x.prisma.challenge.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: 'c1', status: 'accepted' });
    expect(claim.data.status).toBe('completed');
    expect(claim.data.winner_id).toBe(PINILLA);
    // El claim va antes que cualquier efecto.
    const ordenClaim = x.prisma.challenge.updateMany.mock.invocationCallOrder[0];
    expect(ordenClaim).toBeLessThan(x.rules.processWin.mock.invocationCallOrder[0]);
    expect(ordenClaim).toBeLessThan(x.rules.updateStats.mock.invocationCallOrder[0]);
    expect(x.rules.updateStats).toHaveBeenCalledTimes(1);
  });

  it('también reclama sobre un desafío en disputa', async () => {
    const x = await build({ ...base, status: 'disputed' });
    await x.service.resolveChallenge('c1', PINILLA, '6-3, 6-7, 10-4');
    expect(x.prisma.challenge.updateMany.mock.calls[0][0].where.status).toBe('disputed');
  });

  it('si otra petición lo resolvió en paralelo, no aplica nada y avisa', async () => {
    // Las dos leyeron "accepted"; esta perdió el claim.
    const x = await build({ ...base, status: 'accepted' }, 0);

    await expect(
      x.service.resolveChallenge('c1', PINILLA, '6-3, 6-7, 10-4'),
    ).rejects.toThrow(ConflictException);
    nadaSeAplico(x);
  });

  it('el segundo clic sobre un desafío ya completado NO vuelve a sumar nada', async () => {
    // Lo que pasó en producción: la segunda petición llegó con el desafío ya completo.
    const x = await build({
      ...base,
      status: 'completed',
      winner_id: PINILLA,
      final_score: '6-3, 6-7, 10-4',
    });

    await x.service.resolveChallenge('c1', PINILLA, '6-3, 6-7, 10-4');

    nadaSeAplico(x);
    expect(x.prisma.challenge.updateMany).not.toHaveBeenCalled();
  });

  it('en uno completado, con el mismo ganador, solo corrige el marcador', async () => {
    const x = await build({
      ...base,
      status: 'completed',
      winner_id: PINILLA,
      final_score: '6-3, 6-7, 10-5',
    });

    await x.service.resolveChallenge('c1', PINILLA, '6-3, 6-7, 10-4');

    expect(x.prisma.challenge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: { final_score: '6-3, 6-7, 10-4' },
      }),
    );
    nadaSeAplico(x);
  });

  it('si algo falla después del claim, lo suelta para poder reintentar', async () => {
    // Sin esto el desafío quedaba "completado" sin estadísticas, y el reintento
    // del admin caía en "ya completado, solo corrijo el marcador": nunca se aplicaban.
    const x = await build({ ...base, status: 'disputed', final_score: null });
    x.rules.processWin.mockRejectedValue(new Error('se cortó la base'));

    await expect(
      x.service.resolveChallenge('c1', PINILLA, '6-3, 6-7, 10-4'),
    ).rejects.toThrow('se cortó la base');

    const [claim, suelta] = x.prisma.challenge.updateMany.mock.calls.map((c: any[]) => c[0]);
    expect(claim.data.status).toBe('completed');
    // Vuelve exactamente al estado que tenía, solo si sigue siendo el que dejó el claim.
    expect(suelta.where).toEqual({ id: 'c1', status: 'completed', winner_id: PINILLA });
    expect(suelta.data).toEqual({
      status: 'disputed',
      winner_id: null,
      final_score: null,
      played_at: null,
      resolved_at: null,
    });
    expect(x.notifications.notifyMatchResult).not.toHaveBeenCalled();
    expect(whatsappService.sendGroupMessage).not.toHaveBeenCalled();
  });

  it('en uno completado no deja cambiar el ganador en silencio', async () => {
    // Darlo vuelta exigiría revertir estadísticas y posiciones del resultado
    // anterior; aplicarlo encima dejaba dos victorias y dos derrotas contadas.
    const x = await build({
      ...base,
      status: 'completed',
      winner_id: PINILLA,
      final_score: '6-3, 6-7, 10-4',
    });

    await expect(
      x.service.resolveChallenge('c1', PINEDA, '3-6, 7-6, 4-10'),
    ).rejects.toThrow(/Anúlalo/);
    nadaSeAplico(x);
    expect(x.prisma.challenge.update).not.toHaveBeenCalled();
  });
});
