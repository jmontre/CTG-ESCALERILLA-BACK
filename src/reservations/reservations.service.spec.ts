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
