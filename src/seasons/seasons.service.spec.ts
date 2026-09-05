import { Test } from '@nestjs/testing';
import { SeasonsService } from './seasons.service';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LadderService } from '../ladder/ladder.service';

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
  const ladderMock: any = {
    ordered: jest.fn(() => Promise.resolve([])),
    applyOrder: jest.fn(() => Promise.resolve({ total: 0, moved: 0 })),
    retire: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.notification.findFirst.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        SeasonsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AchievementsService, useValue: { grant: jest.fn() } },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: LadderService, useValue: ladderMock },
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

/**
 * El reordenamiento por Master mueve a los 46 de la escalerilla, así que se
 * verifica el orden que sale, no solo que "se llamó a algo".
 */
describe('SeasonsService.reorderByMaster', () => {
  let service: SeasonsService;
  let ladderMock: any;
  let prismaMock: any;

  /** Cuadro terminado: gana `champion`, pierde la final `finalist`. */
  function cuadro(category: string, ids: string[]) {
    return {
      category,
      groups: [
        {
          players: ids.map((id, i) => ({
            player_id: id,
            wins: ids.length - i,
            losses: i,
            sets_won: (ids.length - i) * 2,
            sets_lost: i,
          })),
        },
      ],
      matches: [
        {
          round: 'semifinal',
          status: 'completed',
          player1_id: ids[2],
          player2_id: ids[0],
          winner_id: ids[0],
        },
        {
          round: 'final',
          status: 'completed',
          player1_id: ids[0],
          player2_id: ids[1],
          winner_id: ids[0],
        },
      ],
    };
  }

  /** Escalerilla de `n` jugadores: p1 en el puesto 1, p2 en el 2, etc. */
  function escalerilla(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Jugador ${i + 1}`,
      position: i + 1,
    }));
  }

  async function build(masters: any[], ladderSize = 30) {
    prismaMock = {
      masterSeason: { findMany: jest.fn().mockResolvedValue(masters) },
    };
    ladderMock = {
      ordered: jest.fn().mockResolvedValue(escalerilla(ladderSize)),
      applyOrder: jest.fn().mockResolvedValue({ total: ladderSize, moved: 1 }),
    };
    const module = await Test.createTestingModule({
      providers: [
        SeasonsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AchievementsService, useValue: { grant: jest.fn() } },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: LadderService, useValue: ladderMock },
      ],
    }).compile();
    service = module.get(SeasonsService);
    return { service, ladderMock };
  }

  it('sube a los del cuadro al frente de su categoría y no toca al resto', async () => {
    // Categoría A del esquema v2 = puestos 1-14. El campeón es el que estaba 5°.
    const { service, ladderMock } = await build([
      cuadro('A', ['p5', 'p3', 'p1', 'p2']),
    ]);

    const result = await service.reorderByMaster('s1', 'v2');

    expect(result.reordered).toEqual(['A']);
    const [order] = ladderMock.applyOrder.mock.calls[0];
    expect(order.slice(0, 4)).toEqual(['p5', 'p3', 'p1', 'p2']);
    // Los que no jugaron el cuadro conservan su orden, detrás.
    expect(order.slice(4, 7)).toEqual(['p4', 'p6', 'p7']);
    // Y la escalerilla completa sigue teniendo a todos, una sola vez.
    expect(order).toHaveLength(30);
    expect(new Set(order).size).toBe(30);
  });

  it('no cruza jugadores de una categoría a otra', async () => {
    // p20 está en categoría B (15-28) y gana el Master de B: sube al puesto 15,
    // no al 1.
    const { service, ladderMock } = await build([
      cuadro('B', ['p20', 'p16', 'p15', 'p17']),
    ]);

    await service.reorderByMaster('s1', 'v2');

    const [order] = ladderMock.applyOrder.mock.calls[0];
    expect(order.slice(0, 14)).toEqual(
      Array.from({ length: 14 }, (_, i) => `p${i + 1}`),
    );
    expect(order[14]).toBe('p20');
  });

  it('deja intacta la categoría cuyo cuadro no terminó', async () => {
    const sinFinal = cuadro('A', ['p5', 'p3', 'p1', 'p2']);
    sinFinal.matches = sinFinal.matches.filter((m) => m.round !== 'final');
    const { service, ladderMock } = await build([sinFinal]);

    const result = await service.reorderByMaster('s1', 'v2');

    expect(result.reordered).toEqual([]);
    expect(result.skipped).toEqual(['A']);
    expect(ladderMock.applyOrder).not.toHaveBeenCalled();
  });

  it('en legacy4 conserva la cola de los que están bajo el puesto 48', async () => {
    const { service, ladderMock } = await build(
      [cuadro('A', ['p5', 'p3', 'p1', 'p2'])],
      50,
    );

    await service.reorderByMaster('s1', 'legacy4');

    const [order] = ladderMock.applyOrder.mock.calls[0];
    expect(order).toHaveLength(50);
    expect(order.slice(-2)).toEqual(['p49', 'p50']);
  });
});
