import { Test } from '@nestjs/testing';
import { AchievementsService, categoryOf } from './achievements.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const SEASON = {
  id: 'season-1',
  slug: '2026-2',
  name: 'Escalerilla 2026 · 2do Semestre',
  status: 'active',
  started_at: new Date('2026-07-01T00:00:00.000Z'),
  closed_at: null,
};

const ME = 'me';
const RIVAL = 'rival';

/** Desafío completado ya jugado, con `me` como retador salvo que se diga otra cosa. */
function match(opts: {
  winner: string;
  day: string;
  challenged?: string;
  challenger?: string;
}) {
  return {
    id: `m-${opts.day}`,
    challenger_id: opts.challenger ?? ME,
    challenged_id: opts.challenged ?? RIVAL,
    winner_id: opts.winner,
    played_at: new Date(`2026-${opts.day}T15:00:00.000Z`),
  };
}

describe('AchievementsService', () => {
  let service: AchievementsService;

  const prismaMock = {
    playerAchievement: {
      create: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    season: { findFirst: jest.fn() },
    seasonStanding: { findUnique: jest.fn() },
    challenge: { findMany: jest.fn() },
    player: { findUnique: jest.fn() },
    reservation: { findMany: jest.fn() },
  };
  const notificationsMock = { create: jest.fn() };

  /** Códigos otorgados en la última corrida. */
  const granted = () =>
    prismaMock.playerAchievement.create.mock.calls.map((c) => c[0].data.code);

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.playerAchievement.create.mockResolvedValue({});
    prismaMock.season.findFirst.mockResolvedValue(SEASON);
    prismaMock.seasonStanding.findUnique.mockResolvedValue({
      start_position: null,
    });
    prismaMock.player.findUnique.mockResolvedValue({
      position: 20,
      created_at: new Date('2026-06-01T00:00:00.000Z'), // menos de un año
    });
    prismaMock.challenge.findMany.mockResolvedValue([]);
    prismaMock.reservation.findMany.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        AchievementsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: notificationsMock },
      ],
    }).compile();
    service = module.get(AchievementsService);
  });

  describe('categoryOf', () => {
    // Los rangos en sí se prueban en common/ladder.spec.ts; acá solo que el
    // servicio delegue en esa definición y no tenga una copia propia.
    it('usa los rangos vigentes (3 categorías, sin D)', () => {
      expect(categoryOf(1)).toBe('A');
      expect(categoryOf(14)).toBe('A');
      expect(categoryOf(15)).toBe('B');
      expect(categoryOf(29)).toBe('C');
      expect(categoryOf(48)).toBe('C');
      expect(categoryOf(null)).toBeNull();
      expect(categoryOf(1001)).toBeNull(); // admin
    });

    it('respeta el esquema histórico cuando se lo piden', () => {
      expect(categoryOf(48, 'legacy4')).toBe('D');
    });
  });

  it('otorga Debut en el primer partido del semestre', async () => {
    prismaMock.challenge.findMany.mockResolvedValue([
      match({ winner: ME, day: '07-05' }),
    ]);
    await service.evaluateAfterChallenge({
      winnerId: ME,
      loserId: RIVAL,
      score: '6-4, 6-4',
      oldWinnerPosition: 20,
      oldLoserPosition: 19,
    });
    expect(granted()).toContain('debut');
    expect(granted()).not.toContain('guerrero');
  });

  it('otorga la racha al ganar 3 seguidos, y no antes', async () => {
    prismaMock.challenge.findMany.mockResolvedValue([
      match({ winner: RIVAL, day: '07-01' }),
      match({ winner: ME, day: '07-08' }),
      match({ winner: ME, day: '07-15' }),
      match({ winner: ME, day: '07-22' }),
    ]);
    await service.evaluateAfterChallenge({
      winnerId: ME,
      loserId: RIVAL,
      score: '6-4, 6-4',
      oldWinnerPosition: 20,
      oldLoserPosition: 19,
    });
    expect(granted()).toContain('racha_3');
    expect(granted()).not.toContain('racha_5');
  });

  it('la derrota corta la racha: no otorga nada de racha al perdedor', async () => {
    prismaMock.challenge.findMany.mockResolvedValue([
      match({ winner: ME, day: '07-01' }),
      match({ winner: ME, day: '07-08' }),
      match({ winner: ME, day: '07-15' }),
      match({ winner: RIVAL, day: '07-22' }),
    ]);
    await service.evaluateAfterChallenge({
      winnerId: RIVAL,
      loserId: ME,
      score: '6-4, 6-4',
      oldWinnerPosition: 19,
      oldLoserPosition: 20,
    });
    const codes = granted();
    expect(codes).not.toContain('racha_3');
  });

  it('Muralla exige 3 desafíos RECIBIDOS ganados al hilo', async () => {
    // Tres victorias seguidas pero dos como retador: no es defensa.
    prismaMock.challenge.findMany.mockResolvedValue([
      match({ winner: ME, day: '07-01', challenger: ME }),
      match({ winner: ME, day: '07-08', challenger: RIVAL, challenged: ME }),
      match({ winner: ME, day: '07-15', challenger: ME }),
    ]);
    await service.evaluateAfterChallenge({
      winnerId: ME,
      loserId: RIVAL,
      score: '6-4, 6-4',
      oldWinnerPosition: 20,
      oldLoserPosition: 19,
    });
    expect(granted()).not.toContain('muralla');

    jest.clearAllMocks();
    prismaMock.playerAchievement.create.mockResolvedValue({});
    prismaMock.challenge.findMany.mockResolvedValue([
      match({ winner: ME, day: '07-01', challenger: RIVAL, challenged: ME }),
      match({ winner: ME, day: '07-08', challenger: RIVAL, challenged: ME }),
      match({ winner: ME, day: '07-15', challenger: RIVAL, challenged: ME }),
    ]);
    await service.evaluateAfterChallenge({
      winnerId: ME,
      loserId: RIVAL,
      score: '6-4, 6-4',
      oldWinnerPosition: 20,
      oldLoserPosition: 19,
    });
    expect(granted()).toContain('muralla');
  });

  it('Batacazo solo si el rival estaba 5+ puestos más arriba', async () => {
    prismaMock.challenge.findMany.mockResolvedValue([
      match({ winner: ME, day: '07-05' }),
    ]);
    await service.evaluateAfterChallenge({
      winnerId: ME,
      loserId: RIVAL,
      score: '6-4, 6-4',
      oldWinnerPosition: 20,
      oldLoserPosition: 16, // 4 puestos: no alcanza
    });
    expect(granted()).not.toContain('batacazo');

    jest.clearAllMocks();
    prismaMock.playerAchievement.create.mockResolvedValue({});
    prismaMock.challenge.findMany.mockResolvedValue([
      match({ winner: ME, day: '07-05' }),
    ]);
    await service.evaluateAfterChallenge({
      winnerId: ME,
      loserId: RIVAL,
      score: '6-4, 6-4',
      oldWinnerPosition: 20,
      oldLoserPosition: 15, // 5 puestos: sí
    });
    expect(granted()).toContain('batacazo');
  });

  it('Escalador y Ascenso usan la posición inicial de la temporada', async () => {
    prismaMock.seasonStanding.findUnique.mockResolvedValue({
      start_position: 32,
    });
    prismaMock.player.findUnique.mockResolvedValue({
      position: 20, // subió 12 puestos y pasó de C a B
      created_at: new Date('2026-06-01T00:00:00.000Z'),
    });
    prismaMock.challenge.findMany.mockResolvedValue([
      match({ winner: ME, day: '07-05' }),
    ]);
    await service.evaluateAfterChallenge({
      winnerId: ME,
      loserId: RIVAL,
      score: '6-4, 6-4',
      oldWinnerPosition: 21,
      oldLoserPosition: 20,
    });
    const codes = granted();
    expect(codes).toContain('escalador');
    expect(codes).toContain('ascenso');
    expect(codes).not.toContain('alpinista'); // requiere 20 puestos
  });

  it('Cima al quedar #1', async () => {
    prismaMock.player.findUnique.mockResolvedValue({
      position: 1,
      created_at: new Date('2026-06-01T00:00:00.000Z'),
    });
    prismaMock.challenge.findMany.mockResolvedValue([
      match({ winner: ME, day: '07-05' }),
    ]);
    await service.evaluateAfterChallenge({
      winnerId: ME,
      loserId: RIVAL,
      score: '6-4, 6-4',
      oldWinnerPosition: 2,
      oldLoserPosition: 1,
    });
    expect(granted()).toContain('cima');
  });

  it('sin temporada activa no otorga nada', async () => {
    prismaMock.season.findFirst.mockResolvedValue(null);
    prismaMock.challenge.findMany.mockResolvedValue([
      match({ winner: ME, day: '07-05' }),
    ]);
    await service.evaluateAfterChallenge({
      winnerId: ME,
      loserId: RIVAL,
      score: '6-0, 6-0',
      oldWinnerPosition: 20,
      oldLoserPosition: 10,
    });
    expect(prismaMock.playerAchievement.create).not.toHaveBeenCalled();
  });

  it('un fallo de base no rompe la carga del resultado', async () => {
    prismaMock.challenge.findMany.mockRejectedValue(new Error('db down'));
    await expect(
      service.evaluateAfterChallenge({
        winnerId: ME,
        loserId: RIVAL,
        score: '6-4, 6-4',
        oldWinnerPosition: 20,
        oldLoserPosition: 19,
      }),
    ).resolves.toBeUndefined();
  });

  it('Anfitrión requiere 3 visitas DISTINTAS', async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      { time_slot: '18:15', has_guest: true, guest_name: 'Pedro' },
      { time_slot: '18:15', has_guest: true, guest_name: ' pedro ' },
      { time_slot: '18:15', has_guest: true, guest_name: 'Ana' },
    ]);
    await service.evaluateAfterReservation(ME);
    expect(granted()).not.toContain('anfitrion');

    jest.clearAllMocks();
    prismaMock.playerAchievement.create.mockResolvedValue({});
    prismaMock.season.findFirst.mockResolvedValue(SEASON);
    prismaMock.reservation.findMany.mockResolvedValue([
      { time_slot: '06:00', has_guest: true, guest_name: 'Pedro' },
      { time_slot: '21:45', has_guest: true, guest_name: 'Ana' },
      { time_slot: '18:15', has_guest: true, guest_name: 'Luis' },
    ]);
    await service.evaluateAfterReservation(ME);
    const codes = granted();
    expect(codes).toContain('anfitrion');
    expect(codes).toContain('madrugador');
    expect(codes).toContain('nocturno');
  });
});
