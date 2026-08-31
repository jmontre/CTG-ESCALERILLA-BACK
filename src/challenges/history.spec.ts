import { ChallengesService } from './challenges.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Historial por período.
 *
 * El punto delicado es de dónde salen las stats: `Player.wins/losses` se
 * reinician en cada cierre de temporada, así que un semestre pasado quedaría en
 * cero. Se reconstruyen desde los desafíos, que no se borran nunca.
 *
 * El otro punto es el rango de cada temporada: va desde que empezó hasta que
 * empezó la SIGUIENTE, no hasta su propio `closed_at`. Cerrar una y abrir la
 * otra no ocurre en el mismo instante, y usar `closed_at` dejaría partidos en
 * tierra de nadie.
 */
describe('ChallengesService — historial por período', () => {
  const ME = 'yo';

  const seasons = [
    {
      id: 's1',
      slug: '2026-1',
      name: 'Escalerilla 2026 · 1er Semestre',
      started_at: new Date('2026-01-01T00:00:00Z'),
      closed_at: new Date('2026-08-31T00:00:00Z'),
    },
    {
      id: 's2',
      slug: '2026-2',
      name: 'Escalerilla 2026 · 2do Semestre',
      started_at: new Date('2026-08-30T00:00:00Z'),
      closed_at: null,
    },
  ];

  const partidos = [
    { id: 'm1', winner_id: ME, played_at: new Date('2026-03-10T15:00:00Z') },
    {
      id: 'm2',
      winner_id: 'otro',
      played_at: new Date('2026-06-20T15:00:00Z'),
    },
    { id: 'm3', winner_id: ME, played_at: new Date('2026-09-15T15:00:00Z') },
  ];

  let capturado: any;
  const prismaMock: any = {
    season: { findMany: jest.fn(() => Promise.resolve(seasons)) },
    seasonStanding: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          final_position: 17,
          category: 'B',
          master_result: null,
        }),
      ),
    },
    challenge: {
      findMany: jest.fn((args: any) => {
        capturado = args.where;
        const r = args.where.played_at;
        return Promise.resolve(
          partidos.filter(
            (m) =>
              (!r?.gte || m.played_at >= r.gte) &&
              (!r?.lt || m.played_at < r.lt),
          ),
        );
      }),
    },
  };

  const service = new ChallengesService(
    prismaMock as PrismaService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('ofrece "todo", el año y cada temporada como períodos', async () => {
    const r = await service.historyForPlayer(ME, 'all');
    expect(r.periods.map((p) => p.id)).toEqual([
      'all',
      '2026',
      '2026-1',
      '2026-2',
    ]);
    expect(r.periods.map((p) => p.label)).toEqual([
      'Todo el historial',
      '2026',
      '1er Semestre',
      '2do Semestre',
    ]);
  });

  it('sin período no filtra por fecha y cuenta todo', async () => {
    const r = await service.historyForPlayer(ME, 'all');
    expect(capturado.played_at).toBeUndefined();
    expect(r.stats).toMatchObject({
      played: 3,
      wins: 2,
      losses: 1,
      effectiveness: 67,
    });
  });

  it('una temporada llega hasta el inicio de la siguiente, no hasta su closed_at', async () => {
    // El 2026-1 cerró el 31-ago pero el 2026-2 abrió el 30-ago. Si se usara
    // closed_at, un partido del 30 quedaría contado en las dos.
    await service.historyForPlayer(ME, '2026-1');
    expect(capturado.played_at).toEqual({
      gte: new Date('2026-01-01T00:00:00Z'),
      lt: new Date('2026-08-30T00:00:00Z'),
    });
  });

  it('la última temporada no tiene tope: sigue abierta', async () => {
    await service.historyForPlayer(ME, '2026-2');
    expect(capturado.played_at).toEqual({
      gte: new Date('2026-08-30T00:00:00Z'),
    });
  });

  it('las stats son las del período, no las de toda la vida', async () => {
    const primero = await service.historyForPlayer(ME, '2026-1');
    expect(primero.stats).toMatchObject({ played: 2, wins: 1, losses: 1 });

    const segundo = await service.historyForPlayer(ME, '2026-2');
    expect(segundo.stats).toMatchObject({ played: 1, wins: 1, losses: 0 });
  });

  it('un año agrupa sus temporadas', async () => {
    await service.historyForPlayer(ME, '2026');
    expect(capturado.played_at).toEqual({
      gte: new Date('2026-01-01T00:00:00Z'),
      lt: new Date('2027-01-01T00:00:00Z'),
    });
  });

  it('al elegir una temporada agrega cómo terminó', async () => {
    const r = await service.historyForPlayer(ME, '2026-1');
    expect(r.stats).toMatchObject({ final_position: 17, category: 'B' });
  });

  it('el año y "todo" no traen posición final: no corresponde a un cierre', async () => {
    for (const p of ['all', '2026']) {
      const r = await service.historyForPlayer(ME, p);
      expect(r.stats).not.toHaveProperty('final_position');
    }
  });

  it('un período inventado cae en "todo" en vez de fallar', async () => {
    const r = await service.historyForPlayer(ME, 'no-existe');
    expect(r.selected).toBe('all');
    expect(capturado.played_at).toBeUndefined();
  });
});
