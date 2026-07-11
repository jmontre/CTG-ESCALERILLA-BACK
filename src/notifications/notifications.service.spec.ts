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
