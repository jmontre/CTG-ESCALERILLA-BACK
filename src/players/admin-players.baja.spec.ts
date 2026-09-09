import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminPlayersService } from './admin-players.service';

/**
 * Dar de baja a un socio, restaurarlo y reordenar la escalerilla.
 *
 * El borrado real devolvía 500 para cualquier jugador con historial (la FK de
 * `challenges` lo bloqueaba). Ahora la baja es un **soft delete**: no se toca
 * ni un dato, así el día que el socio vuelve se restaura la cuenta entera.
 */
describe('AdminPlayersService — baja de socios', () => {
  const jugador = {
    id: 'p1-abcdef12-3456',
    user_id: 'u1',
    name: 'Pedro Pérez',
    email: 'pedro@ctg.cl',
    phone: '912345678',
    position: 10,
    deactivated_at: null as Date | null,
  };

  function build(huella: Partial<Record<string, number>> = {}, player: any = jugador) {
    const cuenta = (n = 0) => jest.fn(() => Promise.resolve(n));
    const prisma: any = {
      player: {
        findUnique: jest.fn(() => Promise.resolve(player)),
        findMany: jest.fn(() => Promise.resolve([player])),
        update: jest.fn(() => Promise.resolve(player)),
      },
      user: { delete: jest.fn(), update: jest.fn() },
      notification: { deleteMany: jest.fn() },
      rankingHistory: { deleteMany: jest.fn() },
      challenge: { count: cuenta(huella.challenges ?? 0) },
      masterMatch: { count: cuenta(huella.masterMatches ?? 0) },
      reservation: { count: cuenta(huella.reservations ?? 0) },
      seasonStanding: { count: cuenta(huella.standings ?? 0) },
      $transaction: jest.fn((ops: any[]) => Promise.resolve(ops.map(() => player))),
    };
    const appLogger: any = {
      playerDeleted: jest.fn(),
      playerDeactivated: jest.fn(),
      playerRestored: jest.fn(),
      playerMoved: jest.fn(),
      ladderReordered: jest.fn(),
    };
    const ladder: any = {
      retire: jest.fn(() => Promise.resolve({ player: player.name, from: 10, moved_up: 3 })),
      ordered: jest.fn(() => Promise.resolve([])),
      applyOrder: jest.fn(() => Promise.resolve({ total: 0, moved: 0 })),
      insertAt: jest.fn(() => Promise.resolve({ position: 5 })),
    };
    const reservations: any = {
      cancelActiveForPlayer: jest.fn(() =>
        Promise.resolve({ cancelled: huella.reservations ?? 0, slots: [] }),
      ),
    };
    const adminChallenges: any = {
      cancelOpenForPlayer: jest.fn(() =>
        Promise.resolve({
          cancelled: huella.openChallenges ?? 0,
          rivals: huella.openChallenges ? ['Mateo Carbacho'] : [],
        }),
      ),
    };
    return {
      service: new AdminPlayersService(
        prisma,
        appLogger,
        ladder,
        reservations,
        adminChallenges,
      ),
      prisma,
      ladder,
      appLogger,
      reservations,
      adminChallenges,
    };
  }

  /**
   * El punto entero de la baja: es reversible. Si se pisara el email, el
   * username o la contraseña, "volver" significaría recrear la cuenta a mano.
   */
  it('NO toca ningún dato del jugador: solo lo marca de baja', async () => {
    const { service, prisma } = build({ challenges: 7 });

    const res = await service.deletePlayer(jugador.id);

    expect(res.mode).toBe('deactivated');
    expect(prisma.player.update).toHaveBeenCalledWith({
      where: { id: jugador.id },
      data: { deactivated_at: expect.any(Date), entry_match_available: false },
    });
    // Ni el usuario ni sus notificaciones se tocan: restaurar tiene que
    // devolver la cuenta entera.
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
  });

  it('lo saca de la escalerilla, para no dejar hueco', async () => {
    const { service, ladder } = build({ challenges: 1 });
    await service.deletePlayer(jugador.id);
    expect(ladder.retire).toHaveBeenCalledWith(jugador.id, 'account_closed');
  });

  it('no toca la escalerilla si ya estaba fuera', async () => {
    const { service, ladder } = build({ challenges: 1 }, { ...jugador, position: null });
    await service.deletePlayer(jugador.id);
    expect(ladder.retire).not.toHaveBeenCalled();
  });

  it('anula sus desafíos abiertos, sin efectos', async () => {
    const { service, adminChallenges } = build({ openChallenges: 1 });

    const res = await service.deletePlayer(jugador.id);

    expect(adminChallenges.cancelOpenForPlayer).toHaveBeenCalledWith(
      jugador.id,
      'Anulado por baja del socio',
    );
    expect(res.cancelled_challenges.cancelled).toBe(1);
    expect(res.message).toContain('sin efectos');
    expect(res.message).toContain('Mateo Carbacho');
  });

  it('anula los desafíos ANTES de liberar las canchas', async () => {
    // La cancha reservada para ese partido tiene que entrar en la misma
    // limpieza, sin importar cuál de los dos jugadores la sacó.
    const { service, adminChallenges, reservations } = build({ openChallenges: 1 });

    await service.deletePlayer(jugador.id);

    const anulacion = adminChallenges.cancelOpenForPlayer.mock.invocationCallOrder[0];
    const liberacion = reservations.cancelActiveForPlayer.mock.invocationCallOrder[0];
    expect(anulacion).toBeLessThan(liberacion);
  });

  it('libera las canchas que tenía tomadas', async () => {
    const { service, reservations } = build({ reservations: 2 });

    const res = await service.deletePlayer(jugador.id);

    expect(reservations.cancelActiveForPlayer).toHaveBeenCalledWith(
      jugador.id,
      'Cancelada por baja del socio',
    );
    expect(res.released_reservations.cancelled).toBe(2);
    expect(res.message).toContain('2 reserva(s)');
  });

  it('sin reservas tomadas no menciona ninguna', async () => {
    const { service } = build({ challenges: 1 });
    const res = await service.deletePlayer(jugador.id);
    expect(res.message).not.toContain('reserva');
  });

  it('el mensaje dice cuántos partidos se conservan y que se puede deshacer', async () => {
    const { service } = build({ challenges: 7, masterMatches: 2 });
    const res = await service.deletePlayer(jugador.id);
    expect(res.message).toContain('9 partido');
    expect(res.message).toContain('a su nombre');
    expect(res.message).toContain('lo restauras');
  });

  it('sin partidos jugados no inventa un recuento', async () => {
    const { service } = build();
    const res = await service.deletePlayer(jugador.id);
    expect(res.message).not.toContain('partido(s)');
    expect(res.message).toContain('lo restauras');
  });

  it('no da de baja dos veces al mismo', async () => {
    const { service } = build({}, { ...jugador, deactivated_at: new Date() });
    await expect(service.deletePlayer(jugador.id)).rejects.toThrow(ConflictException);
  });

  it('falla claro si el jugador no existe', async () => {
    const { service, prisma } = build();
    prisma.player.findUnique.mockResolvedValue(null);
    await expect(service.deletePlayer('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('AdminPlayersService.restorePlayer', () => {
  const dado_de_baja = {
    id: 'p1',
    user_id: 'u1',
    name: 'Pedro Pérez',
    position: null,
    deactivated_at: new Date(),
  };

  function build(player: any = dado_de_baja) {
    const prisma: any = {
      player: {
        findUnique: jest.fn(() => Promise.resolve(player)),
        update: jest.fn(() => Promise.resolve(player)),
      },
    };
    const appLogger: any = { playerRestored: jest.fn() };
    return {
      service: new AdminPlayersService(prisma, appLogger, {} as any, {} as any, {} as any),
      prisma,
      appLogger,
    };
  }

  it('lo devuelve activo sin tocar nada más que la marca de baja', async () => {
    const { service, prisma } = build();

    const res = await service.restorePlayer('p1');

    expect(prisma.player.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { deactivated_at: null },
    });
    expect(res.message).toContain('su récord de siempre');
  });

  it('lo deja fuera de la escalerilla: el puesto se lo da el admin', async () => {
    const { service } = build();
    const res = await service.restorePlayer('p1');
    expect(res.message).toContain('Queda fuera de la escalerilla');
  });

  it('no restaura a quien nunca estuvo dado de baja', async () => {
    const { service } = build({ ...dado_de_baja, deactivated_at: null });
    await expect(service.restorePlayer('p1')).rejects.toThrow(ConflictException);
  });
});

describe('AdminPlayersService.purgePlayer', () => {
  function build(huella: Partial<Record<string, number>> = {}, player: any = null) {
    const cuenta = (n = 0) => jest.fn(() => Promise.resolve(n));
    const prisma: any = {
      player: {
        findUnique: jest.fn(() =>
          Promise.resolve(
            player ?? {
              id: 'p1',
              user_id: 'u1',
              name: 'ZZ Typo',
              deactivated_at: new Date(),
            },
          ),
        ),
      },
      user: { delete: jest.fn() },
      notification: { deleteMany: jest.fn() },
      rankingHistory: { deleteMany: jest.fn() },
      challenge: { count: cuenta(huella.challenges ?? 0) },
      masterMatch: { count: cuenta(huella.masterMatches ?? 0) },
      reservation: { count: cuenta(huella.reservations ?? 0) },
      seasonStanding: { count: cuenta(huella.standings ?? 0) },
      $transaction: jest.fn(() => Promise.resolve([])),
    };
    const appLogger: any = { playerDeleted: jest.fn() };
    return {
      service: new AdminPlayersService(prisma, appLogger, {} as any, {} as any, {} as any),
      prisma,
    };
  }

  it('borra de verdad la cuenta dada de baja que no jugó nada', async () => {
    const { service, prisma } = build();
    const res = await service.purgePlayer('p1');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(res.message).toContain('definitivamente');
  });

  it('se niega si tiene aunque sea un partido: es historial de otro socio', async () => {
    const { service, prisma } = build({ challenges: 1 });
    await expect(service.purgePlayer('p1')).rejects.toThrow(
      /historial de otros socios/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('se niega si la cuenta sigue activa: primero hay que darla de baja', async () => {
    const { service } = build({}, {
      id: 'p1',
      user_id: 'u1',
      name: 'Activo',
      deactivated_at: null,
    });
    await expect(service.purgePlayer('p1')).rejects.toThrow(/Primero da de baja/);
  });
});

describe('AdminPlayersService.reorderLadder', () => {
  function build(actuales: Array<{ id: string; name: string }>) {
    const prisma: any = {};
    const appLogger: any = { ladderReordered: jest.fn() };
    const ladder: any = {
      ordered: jest.fn(() => Promise.resolve(actuales)),
      applyOrder: jest.fn((ids: string[]) =>
        Promise.resolve({ total: ids.length, moved: 2 }),
      ),
    };
    return {
      service: new AdminPlayersService(prisma, appLogger, ladder, {} as any, {} as any),
      ladder,
    };
  }

  const escalerilla = [
    { id: 'a', name: 'Ana' },
    { id: 'b', name: 'Beto' },
    { id: 'c', name: 'Caro' },
  ];

  it('guarda el orden nuevo', async () => {
    const { service, ladder } = build(escalerilla);

    const res = await service.reorderLadder(['c', 'a', 'b']);

    expect(ladder.applyOrder).toHaveBeenCalledWith(['c', 'a', 'b'], 'admin_reorder');
    expect(res.message).toContain('2 jugador(es)');
  });

  it('rechaza una lista a la que le falta gente, nombrando a quién', async () => {
    const { service, ladder } = build(escalerilla);

    await expect(service.reorderLadder(['a', 'b'])).rejects.toThrow(/Caro/);
    expect(ladder.applyOrder).not.toHaveBeenCalled();
  });

  it('rechaza una lista con alguien que ya no está en la escalerilla', async () => {
    const { service, ladder } = build(escalerilla);

    await expect(
      service.reorderLadder(['a', 'b', 'c', 'fantasma']),
    ).rejects.toThrow(/cambió mientras editabas/);
    expect(ladder.applyOrder).not.toHaveBeenCalled();
  });

  it('rechaza jugadores repetidos', async () => {
    const { service } = build(escalerilla);
    await expect(service.reorderLadder(['a', 'a', 'b'])).rejects.toThrow(
      /repetidos/,
    );
  });

  it('avisa cuando no hubo nada que cambiar', async () => {
    const { service, ladder } = build(escalerilla);
    ladder.applyOrder.mockResolvedValue({ total: 3, moved: 0 });

    const res = await service.reorderLadder(['a', 'b', 'c']);

    expect(res.message).toBe('No hubo cambios que guardar.');
  });
});

/**
 * Crear un jugador con puesto explícito tiene que CORRER al resto. Escribir la
 * posición directamente dejaba dos jugadores en el mismo puesto — pasó al
 * probar la baja contra la base de dev: el socio nuevo y el que ya estaba
 * quedaron los dos en #45 y el #46 vacío.
 */
describe('AdminPlayersService.createPlayer — posición explícita', () => {
  function build() {
    const creado = { id: 'nuevo', name: 'Nuevo Socio', position: null };
    const prisma: any = {
      user: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({ id: 'u-nuevo' })),
      },
      player: {
        create: jest.fn(() => Promise.resolve(creado)),
        update: jest.fn(() => Promise.resolve(creado)),
        findUnique: jest.fn(() => Promise.resolve({ ...creado, position: 10 })),
      },
    };
    const appLogger: any = { playerCreated: jest.fn() };
    const ladder: any = {
      insertAt: jest.fn(() => Promise.resolve({ position: 10 })),
    };
    return {
      service: new AdminPlayersService(
        prisma,
        appLogger,
        ladder,
        {} as any,
        {} as any,
      ),
      prisma,
      ladder,
    };
  }

  const base = {
    username: 'nuevo',
    email: 'nuevo@ctg.cl',
    password: 'x',
    name: 'Nuevo Socio',
  };

  it('nace fuera de la escalerilla y entra por insertAt, que corre al resto', async () => {
    const { service, prisma, ladder } = build();

    await service.createPlayer({ ...base, position: 10 });

    expect(prisma.player.create.mock.calls[0][0].data.position).toBeNull();
    expect(ladder.insertAt).toHaveBeenCalledWith('nuevo', 10, 'admin_create');
  });

  it('sin puesto queda fuera, con su partido de ingreso disponible', async () => {
    const { service, prisma, ladder } = build();

    await service.createPlayer(base);

    expect(prisma.player.create.mock.calls[0][0].data.entry_match_available).toBe(true);
    expect(ladder.insertAt).not.toHaveBeenCalled();
  });

  it('el admin no pasa por el corrimiento: su posición es una convención', async () => {
    const { service, prisma, ladder } = build();

    await service.createPlayer({ ...base, position: 0, admin_role: 'all' });

    expect(ladder.insertAt).not.toHaveBeenCalled();
    expect(prisma.player.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { position: 0 } }),
    );
  });
});
