import { BadRequestException } from '@nestjs/common';
import { MasterService } from './master.service';

jest.mock('../notifications/whatsapp.service', () => ({
  whatsappService: {
    sendMessage: jest.fn(),
    sendGroupMessage: jest.fn(),
    isReady: () => true,
  },
}));

describe('MasterService.scheduleMatch', () => {
  const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  function build(overrides: any = {}) {
    const match = {
      id: 'm1',
      status: 'pending',
      player1_id: 'p1',
      player2_id: 'p2',
      player1: { id: 'p1', name: 'Uno', phone: null },
      player2: { id: 'p2', name: 'Dos', phone: null },
      season: { category: 'A' },
    };
    const prisma: any = {
      player: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          children: [],
          member_type: 'socio',
          extra_high_demand_slots: 0,
        }),
      },
      masterMatch: {
        findUnique: jest.fn().mockResolvedValue(match),
        update: jest.fn(),
      },
      court: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'c1', is_active: true, name: 'Cancha 1' }),
      },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue({ value: 'verano' }),
      },
      reservation: {
        findFirst: jest.fn().mockResolvedValue(overrides.slotBusy ?? null),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    return { service: new MasterService(prisma), prisma };
  }

  it('rechaza si el slot ya está ocupado', async () => {
    const { service } = build({ slotBusy: { id: 'r9' } });
    await expect(
      service.scheduleMatch('m1', 'u1', futureDate, 'c1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('crea la reserva en una transacción cuando el slot está libre', async () => {
    const { service, prisma } = build();
    await service.scheduleMatch('m1', 'u1', futureDate, 'c1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('sin courtId solo agenda la fecha (sin reserva)', async () => {
    const { service, prisma } = build();
    await service.scheduleMatch('m1', 'u1', futureDate);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.masterMatch.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { scheduled_date: futureDate },
    });
  });
});

describe('MasterService.findByCategory', () => {
  it('incluye los partidos de semifinal y final de la temporada, no solo los de grupo', async () => {
    const prisma: any = {
      masterSeason: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
    };
    const service = new MasterService(prisma);

    await service.findByCategory('B');

    const args = prisma.masterSeason.findFirst.mock.calls[0][0];
    expect(args.include.matches).toBeDefined();
    expect(args.include.matches.where.round.in).toEqual(
      expect.arrayContaining(['semifinal', 'final']),
    );
  });
});

describe('MasterService.findAll', () => {
  it('incluye los partidos de semifinal y final de cada temporada', async () => {
    const prisma: any = {
      masterSeason: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new MasterService(prisma);

    await service.findAll();

    const args = prisma.masterSeason.findMany.mock.calls[0][0];
    expect(args.include.matches).toBeDefined();
    expect(args.include.matches.where.round.in).toEqual(
      expect.arrayContaining(['semifinal', 'final']),
    );
  });
});
