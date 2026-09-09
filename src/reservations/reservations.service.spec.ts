import { Test } from '@nestjs/testing';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppLogger } from '../common/app.logger';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../achievements/achievements.service';

describe('ReservationsService.getAvailability — nombres de compañero/visita', () => {
  let service: ReservationsService;

  const reservation = {
    court_id: 'court-1',
    time_slot: '09:30',
    has_guest: true,
    guest_name: 'Pedro Visitante',
    partner_name: 'Juan Socio',
    school_name: null,
    is_challenge: false,
    is_master: false,
    player: { id: 'p1', name: 'Matías Ríos' },
    master_match: null,
  };

  const prismaMock = {
    systemConfig: {
      findUnique: jest.fn().mockResolvedValue({ value: 'invierno' }),
    },
    court: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'court-1', name: 'Cancha 1', is_active: true },
        ]),
    },
    reservation: { findMany: jest.fn().mockResolvedValue([reservation]) },
    courtBlock: { findMany: jest.fn().mockResolvedValue([]) },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.systemConfig.findUnique.mockResolvedValue({ value: 'invierno' });
    prismaMock.court.findMany.mockResolvedValue([
      { id: 'court-1', name: 'Cancha 1', is_active: true },
    ]);
    prismaMock.reservation.findMany.mockResolvedValue([reservation]);
    prismaMock.courtBlock.findMany.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AppLogger, useValue: {} },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        {
          provide: AchievementsService,
          useValue: { evaluateAfterReservation: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(ReservationsService);
  });

  function slotFor(result: any, slot: string) {
    const court = result.courts.find((c: any) => c.id === 'court-1');
    return court.slots.find((s: any) => s.slot === slot);
  }

  it('sin autenticar (includeNames por defecto false): omite partner_name y guest_name', async () => {
    const result = await service.getAvailability('2026-07-23');
    const s = slotFor(result, '09:30');
    expect(s.reservation).toBeTruthy();
    expect(s.reservation.player_name).toBe('Matías Ríos');
    expect(s.reservation.has_guest).toBe(true);
    expect(s.reservation.partner_name).toBeUndefined();
    expect(s.reservation.guest_name).toBeUndefined();
  });

  it('autenticado (includeNames true): incluye partner_name y guest_name', async () => {
    const result = await service.getAvailability('2026-07-23', true);
    const s = slotFor(result, '09:30');
    expect(s.reservation.partner_name).toBe('Juan Socio');
    expect(s.reservation.guest_name).toBe('Pedro Visitante');
  });
});

/**
 * Cancelación de las canchas de un socio al darlo de baja.
 *
 * Lo delicado es el corte de fechas: las de más adelante se liberan, y las que
 * ya ocurrieron no se tocan (esas las cierra el cron marcándolas `completed`;
 * pisarlas diría que se canceló un partido que sí se jugó).
 */
describe('ReservationsService.cancelActiveForPlayer', () => {
  let service: ReservationsService;
  let prisma: any;

  /** `date` se guarda como medianoche UTC, igual que en la base (@db.Date). */
  const dia = (offsetDias: number) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offsetDias);
    return d;
  };

  async function build(reservas: any[]) {
    prisma = {
      reservation: {
        findMany: jest.fn().mockResolvedValue(reservas),
        updateMany: jest.fn(),
      },
      challenge: { update: jest.fn() },
      masterMatch: { update: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppLogger, useValue: {} },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: AchievementsService, useValue: {} },
      ],
    }).compile();
    service = module.get(ReservationsService);
  }

  const futura = {
    id: 'r1',
    date: dia(3),
    time_slot: '18:15',
    challenge_id: null,
    master_match_id: null,
    court: { name: 'Cancha 1' },
  };

  it('libera las reservas que todavía no se juegan', async () => {
    await build([futura]);

    const res = await service.cancelActiveForPlayer('p1', 'Cancelada por baja del socio');

    expect(res.cancelled).toBe(1);
    expect(res.slots[0]).toContain('18:15');
    expect(res.slots[0]).toContain('Cancha 1');
  });

  it('marca el motivo, para distinguirlas de una cancelación tardía', async () => {
    await build([futura]);

    await service.cancelActiveForPlayer('p1', 'Cancelada por baja del socio');

    // La cancelación tardía descuenta el cupo semanal por su literal exacto;
    // esta no debe caer en esa cuenta.
    const args = prisma.reservation.updateMany.mock.calls[0][0];
    expect(args.data.cancel_reason).toBe('Cancelada por baja del socio');
    expect(args.data.status).toBe('cancelled');
    expect(args.where.id.in).toEqual(['r1']);
  });

  it('no toca las que ya ocurrieron', async () => {
    await build([{ ...futura, id: 'r-viejo', date: dia(-2) }]);

    const res = await service.cancelActiveForPlayer('p1', 'baja');

    expect(res.cancelled).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('solo pide a la base las reservas activas del jugador, de hoy en adelante', async () => {
    await build([]);

    await service.cancelActiveForPlayer('p1', 'baja');

    const { where } = prisma.reservation.findMany.mock.calls[0][0];
    expect(where.player_id).toBe('p1');
    expect(where.status).toBe('active');
    expect(where.date.gte).toBeInstanceOf(Date);
  });

  it('deja sin fecha el desafío que tenía cancha reservada', async () => {
    await build([{ ...futura, challenge_id: 'c1' }]);

    await service.cancelActiveForPlayer('p1', 'baja');

    expect(prisma.challenge.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { scheduled_date: null },
    });
  });

  it('deja sin fecha el partido de Master que tenía cancha reservada', async () => {
    await build([{ ...futura, master_match_id: 'm1' }]);

    await service.cancelActiveForPlayer('p1', 'baja');

    expect(prisma.masterMatch.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { scheduled_date: null },
    });
  });
});
