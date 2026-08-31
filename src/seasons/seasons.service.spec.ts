import { Test } from '@nestjs/testing';
import { SeasonsService } from './seasons.service';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * El podio es la parte que ve TODO el club, campeones y no campeones. Si esto
 * se rompe, el resto del club no se entera de quién ganó el semestre.
 */
describe('SeasonsService — podio', () => {
  let service: SeasonsService;

  const SEASON = {
    id: 's1',
    slug: '2026-1',
    name: 'Escalerilla 2026 · 1er Semestre',
  };

  const standings = [
    {
      season_id: 's1',
      player_id: 'p1',
      category: 'A',
      master_result: 'champion',
      player: { id: 'p1', name: 'Ismael', avatar_url: null },
    },
    {
      season_id: 's1',
      player_id: 'p2',
      category: 'A',
      master_result: 'finalist',
      player: { id: 'p2', name: 'Hernán', avatar_url: null },
    },
    {
      season_id: 's1',
      player_id: 'p3',
      category: 'B',
      master_result: 'champion',
      player: { id: 'p3', name: 'Benjamin', avatar_url: null },
    },
    {
      season_id: 's1',
      player_id: 'p4',
      category: 'B',
      master_result: 'finalist',
      player: { id: 'p4', name: 'Fernando', avatar_url: null },
    },
  ];

  const prismaMock: any = {
    season: { findUnique: jest.fn(() => Promise.resolve(SEASON)) },
    seasonStanding: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          where?.master_result
            ? standings
            : standings.concat([
                {
                  season_id: 's1',
                  player_id: 'p5',
                  category: 'C',
                  master_result: null as any,
                  player: { id: 'p5', name: 'Otro', avatar_url: null },
                },
              ]),
        ),
      ),
    },
    notification: { findFirst: jest.fn(() => Promise.resolve(null)) },
  };
  const notificationsMock: any = { create: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.notification.findFirst.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        SeasonsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AchievementsService, useValue: { grant: jest.fn() } },
        { provide: NotificationsService, useValue: notificationsMock },
      ],
    }).compile();
    service = module.get(SeasonsService);
  });

  it('arma una fila por categoría con campeón y finalista', async () => {
    const rows = await service.podium('s1');
    expect(rows).toEqual([
      { category: 'A', champion: 'Ismael', finalist: 'Hernán' },
      { category: 'B', champion: 'Benjamin', finalist: 'Fernando' },
    ]);
  });

  it('avisa a TODOS los del histórico, no solo a los del podio', async () => {
    const result = await service.notifyPodium('2026-1');
    // 5 standings: los 4 del podio más uno que no ganó nada.
    expect(result.sent).toBe(5);
    expect(notificationsMock.create).toHaveBeenCalledTimes(5);
  });

  it('el aviso nombra a los campeones de cada categoría', async () => {
    await service.notifyPodium('2026-1');
    const [, payload] = notificationsMock.create.mock.calls[0];
    expect(payload.type).toBe('season_winner');
    expect(payload.body).toContain('A: Ismael');
    expect(payload.body).toContain('B: Benjamin');
    expect(payload.body).toContain('campeones y finalistas');
  });

  it('no duplica el aviso a quien ya lo tiene', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'n1' });
    const result = await service.notifyPodium('2026-1');
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(5);
    expect(notificationsMock.create).not.toHaveBeenCalled();
  });
});
