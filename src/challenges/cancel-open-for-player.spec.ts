import { Test } from '@nestjs/testing';
import { AdminChallengesService } from './admin-challenges.service';
import { ChallengeRulesService } from './challenge-rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../achievements/achievements.service';

/**
 * Anulación de los desafíos abiertos al dar de baja a un socio.
 *
 * Lo importante es que sea SIN efectos: si el desafío quedara vivo, el cron lo
 * vencería igual y movería posiciones por un partido contra alguien que ya no
 * está en el club — W.O. a favor del rival, o penalización por no jugarlo.
 */
describe('AdminChallengesService.cancelOpenForPlayer', () => {
  let service: AdminChallengesService;
  let prisma: any;
  let notifications: any;

  const DE_BAJA = 'p-baja';

  const abierto = {
    id: 'c1',
    status: 'accepted',
    challenger_id: DE_BAJA,
    challenged_id: 'p-rival',
    challenger: { id: DE_BAJA, name: 'Pedro Pérez' },
    challenged: { id: 'p-rival', name: 'Ana Rival' },
  };

  async function build(abiertos: any[], claimed = 1) {
    prisma = {
      challenge: {
        findMany: jest.fn().mockResolvedValue(abiertos),
        updateMany: jest.fn().mockResolvedValue({ count: claimed }),
        update: jest.fn(),
      },
      reservation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      player: { update: jest.fn(), findUnique: jest.fn() },
    };
    notifications = { create: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        AdminChallengesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChallengeRulesService, useValue: {} },
        { provide: NotificationsService, useValue: notifications },
        { provide: AchievementsService, useValue: {} },
      ],
    }).compile();
    service = module.get(AdminChallengesService);
  }

  it('anula el desafío sin tocar posiciones ni estadísticas', async () => {
    await build([abierto]);

    const res = await service.cancelOpenForPlayer(DE_BAJA, 'Anulado por baja del socio');

    expect(res.cancelled).toBe(1);
    expect(res.rivals).toEqual(['Ana Rival']);
    // Ni un update de jugador: nadie sube, nadie baja, nadie suma un partido.
    expect(prisma.player.update).not.toHaveBeenCalled();
  });

  it('lo marca cancelado con el motivo, no como ganado por nadie', async () => {
    await build([abierto]);

    await service.cancelOpenForPlayer(DE_BAJA, 'Anulado por baja del socio');

    const { data } = prisma.challenge.updateMany.mock.calls[0][0];
    expect(data.status).toBe('cancelled');
    expect(data.final_score).toBe('Anulado por baja del socio');
    expect(data).not.toHaveProperty('winner_id');
    // Sin fecha agendada: el fixture no debe mostrar día y hora de un desafío
    // que ya no se va a jugar.
    expect(data.scheduled_date).toBeNull();
  });

  it('usa claim atómico, por si el cron lo está venciendo al mismo tiempo', async () => {
    await build([abierto]);

    await service.cancelOpenForPlayer(DE_BAJA, 'baja');

    const { where } = prisma.challenge.updateMany.mock.calls[0][0];
    expect(where.id).toBe('c1');
    expect(where.status.in).toEqual(['pending', 'accepted']);
  });

  it('si el cron se le adelantó, no sigue procesando ese desafío', async () => {
    await build([abierto], 0); // claim.count === 0

    const res = await service.cancelOpenForPlayer(DE_BAJA, 'baja');

    expect(res.cancelled).toBe(0);
    expect(prisma.reservation.updateMany).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('libera la cancha reservada para ese partido, la haya sacado quien la haya sacado', async () => {
    await build([abierto]);

    await service.cancelOpenForPlayer(DE_BAJA, 'Anulado por baja del socio');

    const { where, data } = prisma.reservation.updateMany.mock.calls[0][0];
    expect(where).toEqual({ challenge_id: 'c1', status: 'active' });
    expect(data.status).toBe('cancelled');
  });

  it('avisa al rival, que estaba esperando ese partido', async () => {
    await build([abierto]);

    await service.cancelOpenForPlayer(DE_BAJA, 'baja');
    await new Promise((r) => setImmediate(r)); // la notificación va fire-and-forget

    const [rivalId, payload] = notifications.create.mock.calls[0];
    expect(rivalId).toBe('p-rival');
    expect(payload.body).toContain('Pedro Pérez');
    expect(payload.body).toContain('no cambia tu posición');
  });

  it('encuentra al rival aunque el de baja fuera el desafiado', async () => {
    await build([
      {
        ...abierto,
        challenger_id: 'p-rival',
        challenged_id: DE_BAJA,
        challenger: { id: 'p-rival', name: 'Ana Rival' },
        challenged: { id: DE_BAJA, name: 'Pedro Pérez' },
      },
    ]);

    const res = await service.cancelOpenForPlayer(DE_BAJA, 'baja');

    expect(res.rivals).toEqual(['Ana Rival']);
  });

  it('solo mira los desafíos abiertos: los jugados quedan en el historial', async () => {
    await build([]);

    await service.cancelOpenForPlayer(DE_BAJA, 'baja');

    const { where } = prisma.challenge.findMany.mock.calls[0][0];
    expect(where.status.in).toEqual(['pending', 'accepted']);
    expect(where.OR).toEqual([
      { challenger_id: DE_BAJA },
      { challenged_id: DE_BAJA },
    ]);
  });

  it('sin desafíos abiertos no hace nada', async () => {
    await build([]);

    const res = await service.cancelOpenForPlayer(DE_BAJA, 'baja');

    expect(res).toEqual({ cancelled: 0, rivals: [] });
    expect(prisma.challenge.updateMany).not.toHaveBeenCalled();
  });
});
