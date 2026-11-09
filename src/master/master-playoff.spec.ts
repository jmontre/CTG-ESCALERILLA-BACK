import { BadRequestException } from '@nestjs/common';
import { MasterService, formatMasterDay } from './master.service';

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

describe('MasterService.generateMaster — jugadores que no juegan', () => {
  // Categoría C de producción al 9-nov-2026 (puestos 29 a 46).
  const C = [
    [29, 'Javier Montre'],
    [30, 'Gonzalo Carbacho'],
    [31, 'Cristobal Prado'],
    [32, 'Cristián González'],
    [33, 'Bastian Becerra'],
    [34, 'Gerardo Pérez'],
    [35, 'Daniel Muñoz'],
    [36, 'Gustavo Díaz'],
    [37, 'Daniel Soto Jr'],
    [38, 'Giancarlo Stipo'],
    [39, 'Nicolas Baeza'],
    [40, 'Marianno Stipo'],
    [41, 'JP Urtubia'],
    [42, 'Vicente Tobar'],
    [43, 'Joaquín Quezada'],
    [44, 'Carlos Guzmán'],
    [45, 'Maximiliano Gonzalez'],
    [46, 'Diego Fuenzalida'],
    [1001, 'Administrador'],
  ].map(([pos, name]) => player(String(name), Number(pos), String(name)));

  /** findMany en memoria que entiende los filtros que usa generateMaster. */
  function findMany({ where, take }: any) {
    let out = C.filter((p) => {
      const r = where.position ?? {};
      if (r.gte !== undefined && p.position! < r.gte) return false;
      if (r.lte !== undefined && p.position! > r.lte) return false;
      if (r.lt !== undefined && p.position! >= r.lt) return false;
      if (where.id?.in && !where.id.in.includes(p.id)) return false;
      if (where.id?.notIn && where.id.notIn.includes(p.id)) return false;
      return true;
    }).sort((a, b) => a.position! - b.position!);
    if (take) out = out.slice(0, take);
    return Promise.resolve(out);
  }

  function build() {
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
      player: { findMany: jest.fn(findMany) },
      masterMatch: { create: jest.fn() },
    };
    return { service: new MasterService(prisma), prisma };
  }

  it('sin excluidos, la C se arma del 29° al 40°', async () => {
    const { service, prisma } = build();
    await service.generateMaster({ category: 'C' });
    const seeds = prisma.masterSeason.create.mock.calls[0][0].data
      .seed_player_ids as string[];
    expect(seeds[0]).toBe('Javier Montre');
    expect(seeds[11]).toBe('Marianno Stipo');
  });

  it('con los que no juegan excluidos sale exactamente el cuadro del PDF', async () => {
    const { service, prisma } = build();
    await service.generateMaster({
      category: 'C',
      exclude_player_ids: [
        'Javier Montre',
        'Cristián González',
        'Bastian Becerra',
        'Nicolas Baeza',
      ],
    });
    const seeds = prisma.masterSeason.create.mock.calls[0][0].data
      .seed_player_ids as string[];
    expect(seeds.slice(0, 4)).toEqual([
      'Gonzalo Carbacho',
      'Cristobal Prado',
      'Gerardo Pérez',
      'Daniel Muñoz',
    ]);
    const pairs = prisma.masterMatch.create.mock.calls.map((c: any) => [
      c[0].data.player1_id,
      c[0].data.player2_id,
    ]);
    expect(pairs).toEqual([
      ['Gustavo Díaz', 'Carlos Guzmán'],
      ['Daniel Soto Jr', 'Joaquín Quezada'],
      ['Giancarlo Stipo', 'Vicente Tobar'],
      ['Marianno Stipo', 'JP Urtubia'],
    ]);
    expect(seeds).not.toContain('Administrador');
  });

  it('rechaza excluir a alguien de otra categoría', async () => {
    const { service, prisma } = build();
    await expect(
      service.generateMaster({
        category: 'C',
        exclude_player_ids: ['Javier Montre', 'alguien-de-la-A'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.masterSeason.create).not.toHaveBeenCalled();
  });
});

describe('formatMasterDay', () => {
  const tz = process.env.TZ;
  afterAll(() => {
    process.env.TZ = tz;
  });

  it('no corre el día en hora de Chile', () => {
    process.env.TZ = 'America/Santiago';
    expect(formatMasterDay('2026-12-19', true)).toBe('sábado, 19 de diciembre');
    expect(formatMasterDay('2026-11-16')).toBe('16-11-2026');
  });
});
