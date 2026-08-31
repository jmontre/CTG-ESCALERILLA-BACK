import { Test } from '@nestjs/testing';
import { ChallengeRulesService } from './challenge-rules.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reglas de desaire (rechazo y no-respuesta) y validez del W.O.
 *
 * El prisma mock simula una escalerilla en memoria: `$transaction` ejecuta la
 * lista de promesas tal como lo hace Prisma con un array, así que el orden de
 * los updates —que es lo que evita las colisiones de posición— se prueba de
 * verdad y no queda solo en la intención.
 */
describe('ChallengeRulesService — desaires', () => {
  let service: ChallengeRulesService;
  let ladder: Map<
    string,
    {
      id: string;
      name: string;
      position: number | null;
      no_response_count: number;
      last_wo_win_at: Date | null;
      immune_until: Date | null;
      vulnerable_until: Date | null;
    }
  >;

  function seed(names: string[]) {
    ladder = new Map();
    names.forEach((name, i) => {
      ladder.set(name, {
        id: name,
        name,
        position: i + 1,
        no_response_count: 0,
        last_wo_win_at: null,
        immune_until: null,
        vulnerable_until: null,
      });
    });
  }

  /** La escalerilla como array ordenado por posición, para aserciones legibles. */
  const snapshot = () =>
    [...ladder.values()]
      .filter((p) => p.position != null && p.position < 1000)
      .sort((a, b) => a.position! - b.position!)
      .map((p) => `#${p.position} ${p.name}`);

  const prismaMock = {
    player: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(ladder.get(where.id) ?? null),
      ),
      findFirst: jest.fn(({ orderBy }: any) => {
        const active = [...ladder.values()].filter(
          (p) => p.position != null && p.position >= 1 && p.position < 1000,
        );
        active.sort((a, b) =>
          orderBy?.position === 'desc'
            ? b.position! - a.position!
            : a.position! - b.position!,
        );
        return Promise.resolve(active[0] ?? null);
      }),
      findMany: jest.fn(({ where, orderBy }: any) => {
        let list = [...ladder.values()].filter((p) => p.position != null);
        const pos = where?.position ?? {};
        if (pos.gt !== undefined)
          list = list.filter((p) => p.position! > pos.gt);
        if (pos.gte !== undefined)
          list = list.filter((p) => p.position! >= pos.gte);
        if (pos.lte !== undefined)
          list = list.filter((p) => p.position! <= pos.lte);
        if (pos.lt !== undefined)
          list = list.filter((p) => p.position! < pos.lt);
        list.sort((a, b) =>
          orderBy?.position === 'desc'
            ? b.position! - a.position!
            : a.position! - b.position!,
        );
        return Promise.resolve(list);
      }),
      // Aplica el cambio al construirse, igual que el orden en que Prisma
      // ejecuta el array de $transaction (los literales se evalúan de
      // izquierda a derecha), y devuelve una promesa para que también sirva
      // cuando el servicio hace `await update(...)` suelto.
      update: jest.fn(({ where, data }: any) => {
        const p = ladder.get(where.id)!;
        if (data.position !== undefined) p.position = data.position;
        if (data.no_response_count?.increment) {
          p.no_response_count += data.no_response_count.increment;
        }
        if (data.last_wo_win_at !== undefined)
          p.last_wo_win_at = data.last_wo_win_at;
        if (data.immune_until !== undefined) p.immune_until = data.immune_until;
        if (data.vulnerable_until !== undefined)
          p.vulnerable_until = data.vulnerable_until;
        return Promise.resolve({ ...p });
      }),
      updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    rankingHistory: { create: jest.fn(() => Promise.resolve({})) },
    challenge: {
      count: jest.fn(() => Promise.resolve(0)),
      findFirst: jest.fn((_args: any): Promise<any> => Promise.resolve(null)),
    },
    $transaction: jest.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ChallengeRulesService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(ChallengeRulesService);
  });

  describe('processDecline', () => {
    it('el que desaira baja al puesto del desafiante y los del medio suben uno', async () => {
      seed(['Alfa', 'Beltrán', 'Castro', 'Díaz', 'Escobar', 'Alvarez']);
      // Beltrán es #2, Alvarez (desafiante) es #6.
      await service.processDecline(
        'c1',
        'Alvarez',
        'Beltrán',
        'challenge_rejected',
      );

      expect(snapshot()).toEqual([
        '#1 Alfa',
        '#2 Castro',
        '#3 Díaz',
        '#4 Escobar',
        '#5 Alvarez', // el desafiante sube UN puesto, no salta al #2
        '#6 Beltrán', // el que desairó cae al puesto del desafiante
      ]);
    });

    it('no toca a nadie fuera del tramo entre los dos jugadores', async () => {
      seed([
        'Alfa',
        'Beltrán',
        'Castro',
        'Díaz',
        'Escobar',
        'Alvarez',
        'Fuentes',
      ]);
      await service.processDecline(
        'c1',
        'Alvarez',
        'Castro',
        'challenge_rejected',
      );

      expect(snapshot()).toEqual([
        '#1 Alfa',
        '#2 Beltrán', // intacto: estaba por encima del que desairó
        '#3 Díaz',
        '#4 Escobar',
        '#5 Alvarez',
        '#6 Castro',
        '#7 Fuentes', // intacto: estaba por debajo del desafiante
      ]);
    });

    it('con jugadores adyacentes es un intercambio simple', async () => {
      seed(['Alfa', 'Beltrán', 'Castro']);
      await service.processDecline(
        'c1',
        'Castro',
        'Beltrán',
        'challenge_rejected',
      );
      expect(snapshot()).toEqual(['#1 Alfa', '#2 Castro', '#3 Beltrán']);
    });

    it('no hace nada si el que desaira ya estaba más abajo', async () => {
      seed(['Alfa', 'Beltrán', 'Castro']);
      // Alfa (#1) desafía a Castro (#3): no debería poder, pero si pasa, no rompe.
      await service.processDecline(
        'c1',
        'Alfa',
        'Castro',
        'challenge_rejected',
      );
      expect(snapshot()).toEqual(['#1 Alfa', '#2 Beltrán', '#3 Castro']);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('no deja posiciones duplicadas ni huecos', async () => {
      seed(Array.from({ length: 12 }, (_, i) => `J${i + 1}`));
      await service.processDecline('c1', 'J11', 'J3', 'challenge_not_answered');

      const positions = [...ladder.values()]
        .map((p) => p.position)
        .sort((a, b) => a! - b!);
      expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });
  });

  describe('applyNoResponsePenalty', () => {
    it('la primera no-respuesta solo suma al contador', async () => {
      seed(Array.from({ length: 20 }, (_, i) => `J${i + 1}`));
      const result = await service.applyNoResponsePenalty('J5');
      expect(result).toBeNull();
      expect(ladder.get('J5')!.position).toBe(5);
      expect(ladder.get('J5')!.no_response_count).toBe(1);
    });

    it('la segunda lo manda al último de su categoría', async () => {
      seed(Array.from({ length: 20 }, (_, i) => `J${i + 1}`));
      ladder.get('J5')!.no_response_count = 1;

      const result = await service.applyNoResponsePenalty('J5');

      // J5 está en categoría A (1-14): cae al #14 y los del medio suben uno.
      expect(result).toBe(14);
      expect(ladder.get('J5')!.position).toBe(14);
      expect(ladder.get('J6')!.position).toBe(5);
      expect(ladder.get('J14')!.position).toBe(13);
      expect(ladder.get('J15')!.position).toBe(15); // categoría B, intacto
    });

    it('la tercera lo baja al último de la categoría siguiente', async () => {
      seed(Array.from({ length: 40 }, (_, i) => `J${i + 1}`));
      ladder.get('J5')!.no_response_count = 2;

      const result = await service.applyNoResponsePenalty('J5');

      // Un escalón más abajo: fondo de categoría B (#28).
      expect(result).toBe(28);
      expect(ladder.get('J5')!.position).toBe(28);
    });

    it('no baja más allá del final real de la escalerilla', async () => {
      // Solo 20 jugadores: el fondo de C (#29+) no existe.
      seed(Array.from({ length: 20 }, (_, i) => `J${i + 1}`));
      ladder.get('J2')!.no_response_count = 3; // ya arrastra castigos

      const result = await service.applyNoResponsePenalty('J2');

      expect(result).toBe(20);
      expect(ladder.get('J2')!.position).toBe(20);
      const positions = [...ladder.values()]
        .map((p) => p.position)
        .sort((a, b) => a! - b!);
      expect(positions).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    it('el fondo de la categoría se acota al final real de la escalerilla', async () => {
      // Solo 20 jugadores: la categoría B llega hasta el #28 en teoría, pero
      // el último puesto que existe es el #20.
      seed(Array.from({ length: 20 }, (_, i) => `J${i + 1}`));
      ladder.get('J18')!.no_response_count = 1;

      const result = await service.applyNoResponsePenalty('J18');

      expect(result).toBe(20);
      expect(ladder.get('J18')!.position).toBe(20);
    });

    it('no mueve a quien ya está en el fondo', async () => {
      seed(Array.from({ length: 20 }, (_, i) => `J${i + 1}`));
      ladder.get('J20')!.no_response_count = 1;

      const result = await service.applyNoResponsePenalty('J20');

      expect(result).toBeNull();
      expect(ladder.get('J20')!.position).toBe(20);
      // El contador igual avanza: si vuelve a subir, arrastra el historial.
      expect(ladder.get('J20')!.no_response_count).toBe(2);
    });
  });

  describe('applyPostMatchStatus', () => {
    it('ganar jugando da inmunidad', async () => {
      seed(['Alfa', 'Beltrán']);
      await service.applyPostMatchStatus('Beltrán', 'Alfa');
      expect(ladder.get('Beltrán')!.immune_until).not.toBeNull();
      expect(ladder.get('Alfa')!.vulnerable_until).not.toBeNull();
    });

    it('ganar por W.O. NO da inmunidad, pero el otro igual queda vulnerable', async () => {
      // La inmunidad premia haber jugado y ganado, no que el rival faltara.
      seed(['Alfa', 'Beltrán']);
      await service.applyPostMatchStatus('Beltrán', 'Alfa', {
        grantImmunity: false,
      });
      expect(ladder.get('Beltrán')!.immune_until).toBeNull();
      expect(ladder.get('Alfa')!.vulnerable_until).not.toBeNull();
    });

    it('el #1 nunca recibe inmunidad', async () => {
      seed(['Alfa', 'Beltrán']);
      await service.applyPostMatchStatus('Alfa', 'Beltrán');
      expect(ladder.get('Alfa')!.immune_until).toBeNull();
    });
  });

  describe('rematchCooldownDays', () => {
    const dias = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

    it('bloquea si jugaron hace menos de 5 días y dice cuántos faltan', async () => {
      seed(['Alfa', 'Beltrán']);
      prismaMock.challenge.findFirst.mockResolvedValue({ played_at: dias(2) });
      await expect(
        service.rematchCooldownDays('Alfa', 'Beltrán'),
      ).resolves.toBe(3);
    });

    it('libera al cumplirse los 5 días', async () => {
      seed(['Alfa', 'Beltrán']);
      prismaMock.challenge.findFirst.mockResolvedValue(null);
      await expect(
        service.rematchCooldownDays('Alfa', 'Beltrán'),
      ).resolves.toBeNull();
    });

    it('cuenta el cruce en cualquier dirección', async () => {
      // El bloqueo aplica ganes o pierdas, y sin importar quién desafió.
      seed(['Alfa', 'Beltrán']);
      prismaMock.challenge.findFirst.mockResolvedValue({ played_at: dias(1) });
      await service.rematchCooldownDays('Beltrán', 'Alfa');
      const where = prismaMock.challenge.findFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { challenger_id: 'Beltrán', challenged_id: 'Alfa' },
        { challenger_id: 'Alfa', challenged_id: 'Beltrán' },
      ]);
      expect(where.status).toBe('completed');
    });

    it('solo mira partidos jugados, no rechazos ni no-respuestas', async () => {
      seed(['Alfa', 'Beltrán']);
      prismaMock.challenge.findFirst.mockResolvedValue({ played_at: dias(1) });
      await service.rematchCooldownDays('Alfa', 'Beltrán');
      const where = prismaMock.challenge.findFirst.mock.calls[0][0].where;
      expect(where.status).toBe('completed');
      expect(where.winner_id).toEqual({ not: null });
    });
  });

  describe('canClaimWalkover', () => {
    it('el primer W.O. siempre cuenta', async () => {
      seed(['Alfa']);
      await expect(service.canClaimWalkover('Alfa')).resolves.toBe(true);
    });

    it('no cuenta si no jugó 3 partidos desde el último W.O.', async () => {
      seed(['Alfa']);
      ladder.get('Alfa')!.last_wo_win_at = new Date('2026-08-01');
      prismaMock.challenge.count.mockResolvedValue(2);
      await expect(service.canClaimWalkover('Alfa')).resolves.toBe(false);
    });

    it('vuelve a contar al llegar a 3 partidos jugados', async () => {
      seed(['Alfa']);
      ladder.get('Alfa')!.last_wo_win_at = new Date('2026-08-01');
      prismaMock.challenge.count.mockResolvedValue(3);
      await expect(service.canClaimWalkover('Alfa')).resolves.toBe(true);
    });
  });
});
