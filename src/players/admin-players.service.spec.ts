import { AdminPlayersService } from './admin-players.service';
import { chileWeekBoundsFromStr, currentChileDate } from '../common/dates';

describe('AdminPlayersService.getWeeklyHighDemandUsage', () => {
  function build(player: any, usedCount: number) {
    const prisma: any = {
      player: { findUnique: jest.fn().mockResolvedValue(player) },
      reservation: { count: jest.fn().mockResolvedValue(usedCount) },
    };
    const appLogger: any = {};
    const ladder: any = {};
    return {
      service: new AdminPlayersService(prisma, appLogger, ladder),
      prisma,
    };
  }

  const socio = {
    id: 'p1',
    member_type: 'socio',
    extra_high_demand_slots: 1,
    children: [{ id: 'h1', name: 'Hijo' }],
  };

  it('incluye extra_high_demand_slots e hijos en el límite', async () => {
    const { service } = build(socio, 2);
    const result = await service.getWeeklyHighDemandUsage('p1');
    // 2 base + 1 hijo + 1 extra = 4
    expect(result.limit).toBe(4);
    expect(result.remaining).toBe(2);
  });

  it('usa la semana Chile y cuenta cancelaciones tardías', async () => {
    const { service, prisma } = build(socio, 0);
    await service.getWeeklyHighDemandUsage('p1');
    const where = prisma.reservation.count.mock.calls[0][0].where;
    const { weekStart, weekEnd } = chileWeekBoundsFromStr(currentChileDate());
    expect(where.date).toEqual({ gte: weekStart, lte: weekEnd });
    expect(where.player_id).toEqual({ in: ['p1', 'h1'] });
    expect(where.OR).toEqual([
      { status: 'active' },
      {
        status: 'cancelled',
        cancel_reason: 'Cancelación tardía - turno descontado',
      },
    ]);
  });

  it('hijo_socio tiene límite 1', async () => {
    const { service } = build(
      {
        id: 'h1',
        member_type: 'hijo_socio',
        extra_high_demand_slots: 0,
        children: [],
      },
      1,
    );
    const result = await service.getWeeklyHighDemandUsage('h1');
    expect(result.limit).toBe(1);
    expect(result.remaining).toBe(0);
  });
});
