import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppLogger } from '../common/app.logger';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../achievements/achievements.service';

/**
 * Fija el reloj a una hora Chile del jueves 19-nov-2026. En noviembre Chile
 * está en UTC-3, así que '08:30' Chile son las 11:30 UTC.
 */
function relojChile(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  jest.setSystemTime(new Date(Date.UTC(2026, 10, 19, h + 3, m)));
}

/** `date` de la base: medianoche UTC (@db.Date). */
const dia = (s: string) => new Date(`${s}T00:00:00.000Z`);

const player = {
  id: 'p1',
  user_id: 'u1',
  name: 'Socio',
  phone: null,
  member_type: 'socio',
  has_debt: false,
  children: [],
};

/**
 * Caso del reporte: reserva 07:45 con visita, el socio aprieta "Modificar"
 * mientras juega y la pasa a las 13:00. Eso cancelaba el turno en uso.
 */
describe('Reservas con el turno ya iniciado', () => {
  let service: ReservationsService;
  let prisma: any;

  const enJuego = {
    id: 'r745',
    player_id: 'p1',
    court_id: 'c1',
    date: dia('2026-11-19'),
    time_slot: '07:45',
    status: 'active',
    is_challenge: false,
    has_guest: true,
    guest_fee: 3000,
    challenge_id: null,
    master_match_id: null,
    court: { name: 'Cancha 1' },
  };

  async function build(reservation: any, activas: any[] = []) {
    prisma = {
      player: { findUnique: jest.fn().mockResolvedValue(player) },
      reservation: {
        findUnique: jest.fn().mockResolvedValue(reservation),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue(activas),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'nueva' }),
      },
      court: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'c1', name: 'Cancha 1', is_active: true }),
      },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockResolvedValue([{}, { id: 'nueva' }]),
    };
    const module = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: AppLogger,
          useValue: {
            reservationCreated: jest.fn(),
            reservationCancelled: jest.fn(),
          },
        },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        {
          provide: AchievementsService,
          useValue: {
            evaluateAfterReservation: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();
    service = module.get(ReservationsService);
  }

  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    relojChile('08:30');
  });
  afterEach(() => jest.useRealTimers());

  const aLas13 = { court_id: 'c1', date: '2026-11-19', time_slot: '13:00' };

  describe('modify', () => {
    it('rechaza modificar un turno en juego y no toca la reserva', async () => {
      await build(enJuego);
      await expect(service.modify('u1', 'r745', aLas13)).rejects.toThrow(
        /ya comenzó/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.reservation.update).not.toHaveBeenCalled();
    });

    it('rechaza modificar justo a la hora de inicio', async () => {
      relojChile('07:45');
      await build(enJuego);
      await expect(service.modify('u1', 'r745', aLas13)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza modificar un turno ya completado', async () => {
      await build({ ...enJuego, status: 'completed' });
      await expect(service.modify('u1', 'r745', aLas13)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('permite modificar un turno que todavía no empieza', async () => {
      await build({ ...enJuego, time_slot: '11:15' });
      await service.modify('u1', 'r745', aLas13);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('rechaza mover la reserva a un horario que ya comenzó', async () => {
      await build({ ...enJuego, time_slot: '11:15' });
      await expect(
        service.modify('u1', 'r745', { ...aLas13, time_slot: '07:45' }),
      ).rejects.toThrow(/ya comenzó/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('cancel (socio)', () => {
    it('rechaza cancelar un turno en juego', async () => {
      await build(enJuego);
      await expect(service.cancel('u1', 'r745')).rejects.toThrow(/ya comenzó/);
      expect(prisma.reservation.update).not.toHaveBeenCalled();
    });

    it('rechaza cancelar justo a la hora de inicio', async () => {
      relojChile('07:45');
      await build(enJuego);
      await expect(service.cancel('u1', 'r745')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza cancelar un turno completado', async () => {
      relojChile('06:00');
      await build({ ...enJuego, status: 'completed' });
      await expect(service.cancel('u1', 'r745')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('create: límite de 1 reserva activa', () => {
    const nueva = { court_id: 'c1', date: '2026-11-19', time_slot: '13:00' };

    it('el turno en juego sigue contando como reserva activa', async () => {
      await build(null, [enJuego]);
      await expect(service.create('u1', nueva)).rejects.toThrow(
        /reserva activa/,
      );
    });

    it('un turno ya terminado no bloquea aunque el cron no lo haya completado', async () => {
      relojChile('09:20'); // 07:45 + 90 min = 09:15
      await build(null, [enJuego]);
      await service.create('u1', nueva);
      expect(prisma.reservation.create).toHaveBeenCalled();
    });
  });
});
