import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminPlayersService } from './admin-players.service';

/**
 * Dar de baja a un socio y reordenar la escalerilla desde el panel.
 *
 * El borrado real devolvía 500 para cualquier jugador con historial (la FK de
 * `challenges` lo bloqueaba). Ahora: sin rastro se borra, con rastro se
 * anonimiza y sus partidos siguen en el historial de los rivales.
 */
describe('AdminPlayersService — baja de socios', () => {
  const jugador = {
    id: 'p1-abcdef12-3456',
    user_id: 'u1',
    name: 'Pedro Pérez',
    position: 10,
    anonymized_at: null,
  };

  function build(huella: Partial<Record<string, number>> = {}, player = jugador) {
    const cuenta = (n = 0) => jest.fn(() => Promise.resolve(n));
    const prisma: any = {
      player: {
        findUnique: jest.fn(() => Promise.resolve(player)),
        update: jest.fn(() => Promise.resolve({ ...player, name: 'Socio retirado' })),
      },
      user: { delete: jest.fn(), update: jest.fn() },
      notification: { deleteMany: jest.fn() },
      rankingHistory: { deleteMany: jest.fn() },
      challenge: { count: cuenta(huella.challenges ?? 0) },
      masterMatch: { count: cuenta(huella.masterMatches ?? 0) },
      reservation: { count: cuenta(huella.reservations ?? 0) },
      seasonStanding: { count: cuenta(huella.standings ?? 0) },
      $transaction: jest.fn((ops: any[]) =>
        Promise.resolve(ops.map(() => ({ ...player, name: 'Socio retirado' }))),
      ),
    };
    const appLogger: any = {
      playerDeleted: jest.fn(),
      playerAnonymized: jest.fn(),
      playerMoved: jest.fn(),
      ladderReordered: jest.fn(),
    };
    const ladder: any = {
      retire: jest.fn(() => Promise.resolve({ player: player.name, from: 10, moved_up: 3 })),
      ordered: jest.fn(() => Promise.resolve([])),
      applyOrder: jest.fn(() => Promise.resolve({ total: 0, moved: 0 })),
      insertAt: jest.fn(() => Promise.resolve({ position: 5 })),
    };
    return {
      service: new AdminPlayersService(prisma, appLogger, ladder),
      prisma,
      ladder,
      appLogger,
    };
  }

  it('borra de verdad la cuenta que no jugó nada', async () => {
    const { service, prisma, appLogger } = build();

    const res = await service.deletePlayer(jugador.id);

    expect(res.mode).toBe('deleted');
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(appLogger.playerDeleted).toHaveBeenCalled();
  });

  it('anonimiza —no borra— a quien tiene desafíos jugados', async () => {
    const { service, prisma } = build({ challenges: 7 });

    const res = await service.deletePlayer(jugador.id);

    expect(res.mode).toBe('anonymized');
    expect(prisma.user.delete).not.toHaveBeenCalled();
    // La fila del jugador sigue viva: las FK de los partidos tienen que resolver.
    const update = prisma.player.update.mock.calls[0][0];
    expect(update.data.name).toBe('Socio retirado');
    expect(update.data.anonymized_at).toBeInstanceOf(Date);
    expect(update.data.position).toBeNull();
  });

  it('el mensaje dice cuántos partidos se conservan y por qué', async () => {
    const { service } = build({ challenges: 7, masterMatches: 2 });

    const res = await service.deletePlayer(jugador.id);

    expect(res.message).toContain('7 desafío');
    expect(res.message).toContain('2 partido');
    expect(res.message).toContain('rivales');
  });

  it('una reserva también cuenta como historial', async () => {
    const { service } = build({ reservations: 1 });
    expect((await service.deletePlayer(jugador.id)).mode).toBe('anonymized');
  });

  it('deja los datos personales en blanco y la cuenta sin poder entrar', async () => {
    const { service, prisma } = build({ challenges: 1 });

    await service.deletePlayer(jugador.id);

    const { data } = prisma.player.update.mock.calls[0][0];
    expect(data.phone).toBeNull();
    expect(data.avatar_url).toBeNull();
    expect(data.email).toMatch(/^retirado-.*@ctg\.invalid$/);

    const userUpdate = prisma.user.update.mock.calls[0][0];
    expect(userUpdate.data.username).toMatch(/^retirado-/);
    expect(userUpdate.data.is_admin).toBe(false);
    // Hash aleatorio: no es el hash de ninguna contraseña conocida.
    expect(userUpdate.data.password_hash).toHaveLength(96);
  });

  it('lo saca de la escalerilla antes, para no dejar hueco', async () => {
    const { service, ladder } = build({ challenges: 1 });

    await service.deletePlayer(jugador.id);

    expect(ladder.retire).toHaveBeenCalledWith(jugador.id, 'account_closed');
  });

  it('no toca la escalerilla si ya estaba fuera', async () => {
    const { service, ladder } = build({ challenges: 1 }, { ...jugador, position: null } as any);

    await service.deletePlayer(jugador.id);

    expect(ladder.retire).not.toHaveBeenCalled();
  });

  it('no da de baja dos veces al mismo', async () => {
    const { service } = build({}, { ...jugador, anonymized_at: new Date() } as any);
    await expect(service.deletePlayer(jugador.id)).rejects.toThrow(ConflictException);
  });

  it('falla claro si el jugador no existe', async () => {
    const { service, prisma } = build();
    prisma.player.findUnique.mockResolvedValue(null);
    await expect(service.deletePlayer('nope')).rejects.toThrow(NotFoundException);
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
      service: new AdminPlayersService(prisma, appLogger, ladder),
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
