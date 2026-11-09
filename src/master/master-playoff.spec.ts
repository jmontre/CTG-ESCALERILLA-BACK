import { BadRequestException } from '@nestjs/common';
import { MasterService } from './master.service';

jest.mock('../notifications/whatsapp.service', () => ({
  whatsappService: {
    sendMessage: jest.fn(),
    sendGroupMessage: jest.fn(),
    isReady: () => true,
  },
}));

const player = (id: string, position: number | null, name = id) => ({
  id,
  name,
  position,
  phone: null,
});

describe('MasterService — sembrado congelado al generar', () => {
  it('generateMaster guarda los 12 primeros del rango en orden', async () => {
    const players = Array.from({ length: 14 }, (_, i) =>
      player(`p${i + 1}`, i + 1),
    );
    const prisma: any = {
      season: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 's1', name: '2026-2', status: 'active' }),
      },
      masterSeason: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ms1' }),
      },
      player: { findMany: jest.fn().mockResolvedValue(players) },
      masterMatch: { create: jest.fn() },
    };
    const service = new MasterService(prisma);
    await service.generateMaster({ category: 'A' });

    const data = prisma.masterSeason.create.mock.calls[0][0].data;
    expect(data.seed_player_ids).toEqual(players.slice(0, 12).map((p) => p.id));
    // 5v12, 6v11, 7v10, 8v9
    const pairs = prisma.masterMatch.create.mock.calls.map((c: any) => [
      c[0].data.player1_id,
      c[0].data.player2_id,
    ]);
    expect(pairs).toEqual([
      ['p5', 'p12'],
      ['p6', 'p11'],
      ['p7', 'p10'],
      ['p8', 'p9'],
    ]);
  });

  /**
   * Arma los grupos tras completar el último playoff. `positionsNow` simula
   * que la escalerilla se movió durante la semana del playoff.
   */
  function buildGroups(seeds: string[], positionsNow: Record<string, number>) {
    const all = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
    const byId = (id: string) => player(id, positionsNow[id] ?? null);
    // Ganan los mejor sembrados: p5, p6, p7, p8.
    const playoffs = [
      ['p5', 'p12'],
      ['p6', 'p11'],
      ['p7', 'p10'],
      ['p8', 'p9'],
    ].map(([a, b], i) => ({
      id: `m${i}`,
      season_id: 'ms1',
      round: 'playoff',
      status: 'completed',
      winner_id: a,
      winner: byId(a),
      player1_id: a,
      player2_id: b,
    }));
    const groups: Record<string, string[]> = {};
    let currentGroup = '';
    const prisma: any = {
      masterSeason: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ms1',
          category: 'A',
          status: 'playoffs',
          seed_player_ids: seeds,
        }),
        update: jest.fn(),
      },
      masterMatch: {
        findUnique: jest.fn().mockResolvedValue({
          ...playoffs[3],
          status: 'pending',
          player1: byId('p8'),
          player2: byId('p9'),
        }),
        findMany: jest.fn().mockResolvedValue(playoffs),
        update: jest.fn(),
        create: jest.fn(),
      },
      reservation: { updateMany: jest.fn() },
      masterGroup: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => {
          currentGroup = data.name;
          groups[currentGroup] = [];
          return { id: data.name };
        }),
      },
      masterGroupPlayer: {
        create: jest.fn().mockImplementation(({ data }) => {
          groups[currentGroup].push(data.player_id);
        }),
      },
      player: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          if (where.id?.in) return where.id.in.map(byId);
          // Fallback por posición actual
          return all
            .map(byId)
            .filter((p) => p.position !== null && p.position <= 14)
            .sort((a, b) => a.position - b.position)
            .slice(0, 4);
        }),
      },
    };
    return { service: new MasterService(prisma), groups };
  }

  it('los grupos usan los directos de la generación aunque la escalerilla se haya movido', async () => {
    const seeds = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
    // p9 (eliminado en el playoff) ganó un desafío y ahora es 2°.
    const positionsNow = {
      p1: 1,
      p9: 2,
      p2: 3,
      p3: 4,
      p4: 5,
      p5: 6,
      p6: 7,
      p7: 8,
      p8: 9,
      p10: 10,
      p11: 11,
      p12: 12,
    };
    const { service, groups } = buildGroups(seeds, positionsNow);
    await service.submitResult('m3', 'p8', '6-1, 6-1');

    expect(groups['Grupo A']).toEqual(['p1', 'p3', 'p5', 'p7']);
    expect(groups['Grupo B']).toEqual(['p2', 'p4', 'p6', 'p8']);
  });

  it('cuadros sin sembrado guardado siguen usando la posición actual', async () => {
    const positionsNow = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`p${i + 1}`, i + 1]),
    );
    const { service, groups } = buildGroups([], positionsNow);
    await service.submitResult('m3', 'p8', '6-1, 6-1');

    expect(groups['Grupo A']).toEqual(['p1', 'p3', 'p5', 'p7']);
    expect(groups['Grupo B']).toEqual(['p2', 'p4', 'p6', 'p8']);
  });
});

describe('MasterService.replacePlayoffPlayer', () => {
  function build(overrides: any = {}) {
    const match = {
      id: 'm1',
      round: 'playoff',
      status: 'pending',
      season_id: 'ms1',
      player1_id: 'p5',
      player2_id: 'p12',
      player1_result: null,
      player2_result: null,
      player1: player('p5', 5, 'Cinco'),
      player2: player('p12', 12, 'Doce'),
      season: {
        id: 'ms1',
        season_id: 's1',
        category: 'A',
        seed_player_ids: Array.from({ length: 12 }, (_, i) => `p${i + 1}`),
      },
      ...overrides.match,
    };
    const prisma: any = {
      masterMatch: {
        findUnique: jest.fn().mockResolvedValue(match),
        findFirst: jest.fn().mockResolvedValue(overrides.alreadyIn ?? null),
        update: jest.fn((x) => ({ op: 'match', ...x })),
      },
      masterSeason: {
        findFirst: jest.fn().mockResolvedValue(overrides.seeded ?? null),
        update: jest.fn((x) => ({ op: 'season', ...x })),
      },
      player: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            'newPlayer' in overrides
              ? overrides.newPlayer
              : { ...player('p13', 13, 'Trece'), deactivated_at: null },
          ),
      },
      reservation: {
        findFirst: jest.fn().mockResolvedValue(overrides.reservation ?? null),
        update: jest.fn((x) => ({ op: 'reservation', ...x })),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    return { service: new MasterService(prisma), prisma };
  }

  const ops = (prisma: any) => prisma.$transaction.mock.calls[0][0];

  it('reemplaza al jugador y le pasa su lugar en el sembrado', async () => {
    const { service, prisma } = build();
    await service.replacePlayoffPlayer('m1', 'p12', 'p13');

    const [matchOp, seasonOp] = ops(prisma);
    expect(matchOp.data).toEqual({ player2_id: 'p13' });
    expect(seasonOp.data.seed_player_ids[11]).toBe('p13');
    expect(seasonOp.data.seed_player_ids).not.toContain('p12');
  });

  it('cancela la reserva y libera la fecha si la había hecho quien sale', async () => {
    const { service, prisma } = build({
      reservation: { id: 'r1', player_id: 'p12' },
    });
    await service.replacePlayoffPlayer('m1', 'p12', 'p13');

    const [matchOp, , resOp] = ops(prisma);
    expect(matchOp.data).toEqual({ player2_id: 'p13', scheduled_date: null });
    expect(resOp.data.status).toBe('cancelled');
  });

  it('mantiene la reserva del rival con el nombre del reemplazante', async () => {
    const { service, prisma } = build({
      reservation: { id: 'r1', player_id: 'p5' },
    });
    await service.replacePlayoffPlayer('m1', 'p12', 'p13');

    const [matchOp, , resOp] = ops(prisma);
    expect(matchOp.data).toEqual({ player2_id: 'p13' });
    expect(resOp.data).toEqual({ partner_name: 'Trece' });
  });

  it.each([
    ['no es de playoff', { match: { round: 'group' } }],
    ['ya está completado', { match: { status: 'completed' } }],
    ['está en disputa', { match: { status: 'disputed' } }],
    ['ya hay un resultado cargado', { match: { player1_result: {} } }],
    ['el reemplazante ya juega el Master', { alreadyIn: { id: 'mX' } }],
    ['el reemplazante es directo del Master', { seeded: { id: 'ms2' } }],
    ['el reemplazante no existe', { newPlayer: null }],
  ])('rechaza si %s', async (_, overrides) => {
    const { service, prisma } = build(overrides);
    await expect(
      service.replacePlayoffPlayer('m1', 'p12', 'p13'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza si el jugador a reemplazar no juega ese partido', async () => {
    const { service } = build();
    await expect(
      service.replacePlayoffPlayer('m1', 'p7', 'p13'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
