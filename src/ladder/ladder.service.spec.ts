import { BadRequestException } from '@nestjs/common';
import { LadderService } from './ladder.service';

/**
 * Escalerilla en memoria: el punto de estos tests es que NUNCA queden huecos
 * ni puestos repetidos, que es lo que pasaba al poner `position = null` a mano.
 */
function buildPrisma(names: string[]) {
  const players: Array<{ id: string; name: string; position: number | null }> =
    names.map((name, i) => ({ id: name, name, position: i + 1 }));

  const matches = (p: (typeof players)[number], where: any) => {
    if (p.position == null) return false;
    const cond = where?.position ?? {};
    if (cond.gte !== undefined && p.position < cond.gte) return false;
    if (cond.gt !== undefined && p.position <= cond.gt) return false;
    if (cond.lte !== undefined && p.position > cond.lte) return false;
    if (cond.lt !== undefined && p.position >= cond.lt) return false;
    return true;
  };

  const sort = (list: typeof players, orderBy: any) => {
    const dir = orderBy?.position === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => (a.position - b.position) * dir);
  };

  const prisma: any = {
    player: {
      findUnique: ({ where }: any) =>
        Promise.resolve(players.find((p) => p.id === where.id) ?? null),
      findFirst: ({ where, orderBy }: any) =>
        Promise.resolve(
          sort(
            players.filter((p) => matches(p, where)),
            orderBy,
          )[0] ?? null,
        ),
      findMany: ({ where, orderBy }: any) =>
        Promise.resolve(
          sort(
            players.filter((p) => matches(p, where)),
            orderBy,
          ),
        ),
      // La escritura se difiere igual que Prisma: el $transaction las corre.
      update:
        ({ where, data }: any) =>
        () => {
          const player = players.find((p) => p.id === where.id);
          player.position = data.position;
        },
    },
    rankingHistory: { create: () => () => undefined },
    $transaction: jest.fn((ops: Array<() => void>) => {
      ops.forEach((op) => typeof op === 'function' && op());
      return Promise.resolve([]);
    }),
  };

  // Fuera de transacción (update directo), Prisma resuelve la promesa sola.
  const rawUpdate = prisma.player.update;
  prisma.player.update = (args: any) => {
    const deferred = rawUpdate(args);
    return Object.assign(Promise.resolve().then(deferred), {
      then: (res: any) => Promise.resolve(deferred()).then(res),
    });
  };

  return {
    prisma,
    players,
    orden: () =>
      sort(
        players.filter((p) => p.position != null),
        {},
      ).map((p) => p.name),
  };
}

describe('LadderService', () => {
  describe('retire', () => {
    it('saca al jugador y compacta los puestos de abajo', async () => {
      const { prisma, players, orden } = buildPrisma(['a', 'b', 'c', 'd', 'e']);
      const service = new LadderService(prisma);

      const result = await service.retire('b');

      expect(result).toMatchObject({ player: 'b', from: 2, moved_up: 3 });
      expect(orden()).toEqual(['a', 'c', 'd', 'e']);
      expect(players.find((p) => p.id === 'b').position).toBeNull();
    });

    it('sacar al último no mueve a nadie', async () => {
      const { prisma, orden } = buildPrisma(['a', 'b', 'c']);
      const service = new LadderService(prisma);

      const result = await service.retire('c');

      expect(result.moved_up).toBe(0);
      expect(orden()).toEqual(['a', 'b']);
    });

    it('no deja sacar dos veces al mismo', async () => {
      const { prisma } = buildPrisma(['a', 'b']);
      const service = new LadderService(prisma);

      await service.retire('a');
      await expect(service.retire('a')).rejects.toThrow(BadRequestException);
    });
  });

  describe('insertAt', () => {
    it('mete al de afuera en el puesto pedido y baja al resto', async () => {
      const { prisma, players, orden } = buildPrisma(['a', 'b', 'c', 'd']);
      players.push({ id: 'nuevo', name: 'nuevo', position: null });
      const service = new LadderService(prisma);

      await service.insertAt('nuevo', 2, 'entry_match_won');

      expect(orden()).toEqual(['a', 'nuevo', 'b', 'c', 'd']);
    });

    it('acota el puesto al final de la escalerilla', async () => {
      const { prisma, players, orden } = buildPrisma(['a', 'b']);
      players.push({ id: 'nuevo', name: 'nuevo', position: null });
      const service = new LadderService(prisma);

      await service.insertAt('nuevo', 99, 'entry_match_won');

      expect(orden()).toEqual(['a', 'b', 'nuevo']);
    });

    it('mover a uno que ya estaba dentro no duplica ni deja huecos', async () => {
      const { prisma, orden } = buildPrisma(['a', 'b', 'c', 'd', 'e']);
      const service = new LadderService(prisma);

      await service.insertAt('e', 2, 'rejoined_ladder');

      expect(orden()).toEqual(['a', 'e', 'b', 'c', 'd']);
    });
  });

  describe('sendToBottom', () => {
    it('deja último al que venía de afuera', async () => {
      const { prisma, players, orden } = buildPrisma(['a', 'b', 'c']);
      players.push({ id: 'nuevo', name: 'nuevo', position: null });
      const service = new LadderService(prisma);

      await service.sendToBottom('nuevo', 'entry_match_lost');

      expect(orden()).toEqual(['a', 'b', 'c', 'nuevo']);
    });

    it('deja último al que ya estaba dentro, sin dejar hueco', async () => {
      const { prisma, orden } = buildPrisma(['a', 'b', 'c', 'd']);
      const service = new LadderService(prisma);

      await service.sendToBottom('b', 'entry_match_lost');

      expect(orden()).toEqual(['a', 'c', 'd', 'b']);
    });
  });

  describe('applyOrder', () => {
    it('reescribe el orden completo y solo cuenta los que se movieron', async () => {
      const { prisma, orden } = buildPrisma(['a', 'b', 'c', 'd']);
      const service = new LadderService(prisma);

      const result = await service.applyOrder(
        ['a', 'd', 'b', 'c'],
        'master_reorder',
      );

      expect(orden()).toEqual(['a', 'd', 'b', 'c']);
      expect(result).toEqual({ total: 4, moved: 3 });
    });

    it('un orden idéntico no escribe nada', async () => {
      const { prisma } = buildPrisma(['a', 'b', 'c']);
      const service = new LadderService(prisma);

      const result = await service.applyOrder(
        ['a', 'b', 'c'],
        'master_reorder',
      );

      expect(result.moved).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
