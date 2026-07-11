import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  const prismaMock = {
    player: { findUnique: jest.fn() },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('create persiste la notificación para el jugador', async () => {
    await service.create('player-1', {
      type: 'challenge_received',
      title: '¡Tienes un desafío!',
      body: 'Juan te desafió.',
      action_label: 'Responder',
      action_path: '/fixture',
    });
    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        player_id: 'player-1',
        type: 'challenge_received',
      }),
    });
  });

  it('create no lanza si prisma falla (best-effort)', async () => {
    prismaMock.notification.create.mockRejectedValue(new Error('db down'));
    await expect(
      service.create('player-1', { type: 'x', title: 't', body: 'b' }),
    ).resolves.toBeUndefined();
  });

  it('notifyMatchResult sin swap emite solo 2 result_confirmed a los jugadores correctos', async () => {
    await service.notifyMatchResult({
      winnerId: 'winner-1',
      loserId: 'loser-1',
      winnerName: 'Ana',
      loserName: 'Beto',
      score: '6-4 6-2',
      positionsSwapped: false,
    });
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.notification.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        player_id: 'winner-1',
        type: 'result_confirmed',
        body: 'Victoria 6-4 6-2 vs Beto.',
        action_path: '/historial',
      }),
    });
    expect(prismaMock.notification.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        player_id: 'loser-1',
        type: 'result_confirmed',
        body: 'Derrota 6-4 6-2 vs Ana.',
        action_path: '/historial',
      }),
    });
  });

  it('notifyMatchResult con swap emite 4: result_confirmed + position_up/down', async () => {
    await service.notifyMatchResult({
      winnerId: 'winner-1',
      loserId: 'loser-1',
      winnerName: 'Ana',
      loserName: 'Beto',
      score: '7-5 6-4',
      positionsSwapped: true,
      winnerPosition: 5,
      loserPosition: 8,
    });
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(4);
    expect(prismaMock.notification.create).toHaveBeenNthCalledWith(3, {
      data: expect.objectContaining({
        player_id: 'winner-1',
        type: 'position_up',
        body: 'Ahora eres #5 de la escalerilla.',
        action_path: '/escalerilla',
      }),
    });
    expect(prismaMock.notification.create).toHaveBeenNthCalledWith(4, {
      data: expect.objectContaining({
        player_id: 'loser-1',
        type: 'position_down',
        body: 'Ahora eres #8. ¡A recuperarla!',
        action_path: '/escalerilla',
      }),
    });
  });

  it('findForUser devuelve [] si el usuario no tiene player', async () => {
    prismaMock.player.findUnique.mockResolvedValue(null);
    expect(await service.findForUser('user-x')).toEqual([]);
  });

  it('findForUser lista las últimas 50 del jugador', async () => {
    prismaMock.player.findUnique.mockResolvedValue({ id: 'player-1' });
    prismaMock.notification.findMany.mockResolvedValue([]);
    await service.findForUser('user-1');
    expect(prismaMock.notification.findMany).toHaveBeenCalledWith({
      where: { player_id: 'player-1' },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  });

  it('markRead solo marca notificaciones del propio jugador', async () => {
    prismaMock.player.findUnique.mockResolvedValue({ id: 'player-1' });
    prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });
    await service.markRead('user-1', 'notif-9');
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'notif-9', player_id: 'player-1' },
      data: { read: true },
    });
  });

  it('markAllRead marca solo las no leídas del jugador', async () => {
    prismaMock.player.findUnique.mockResolvedValue({ id: 'player-1' });
    prismaMock.notification.updateMany.mockResolvedValue({ count: 3 });
    await service.markAllRead('user-1');
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { player_id: 'player-1', read: false },
      data: { read: true },
    });
  });
});
