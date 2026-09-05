import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChallengeRulesService } from './challenge-rules.service';
import { LadderService } from '../ladder/ladder.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Partido de ingreso: el socio nuevo (o el que vuelve) elige rival del tope
 * hacia abajo. Si gana entra en su puesto, si pierde entra último, y en los
 * dos casos gasta su única oportunidad.
 */
describe('Partido de ingreso', () => {
  let service: ChallengeRulesService;
  let prisma: any;
  let ladder: any;

  const ingresante = {
    id: 'nuevo',
    name: 'Nuevo',
    position: null,
    entry_match_available: true,
    immune_until: null,
    vulnerable_until: null,
  };
  const rival = {
    id: 'rival',
    name: 'Rival',
    position: 20,
    entry_match_available: false,
    immune_until: null,
    vulnerable_until: null,
  };

  async function build(players: any[] = [ingresante, rival], limit = '15') {
    prisma = {
      player: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(players.find((p) => p.id === where.id) ?? null),
        ),
        findMany: jest.fn(() => Promise.resolve(players)),
        update: jest.fn(() => Promise.resolve({})),
      },
      challenge: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        findFirst: jest.fn(() => Promise.resolve(null)),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      systemConfig: {
        findUnique: jest.fn(() =>
          Promise.resolve(limit ? { value: limit } : null),
        ),
        upsert: jest.fn(() => Promise.resolve({})),
      },
    };
    ladder = {
      insertAt: jest.fn(() => Promise.resolve({ position: 20 })),
      sendToBottom: jest.fn(() => Promise.resolve({ position: 46 })),
    };
    const module = await Test.createTestingModule({
      providers: [
        ChallengeRulesService,
        { provide: PrismaService, useValue: prisma },
        { provide: LadderService, useValue: ladder },
      ],
    }).compile();
    service = module.get(ChallengeRulesService);
  }

  describe('tope de puesto', () => {
    it('usa el tope configurado', async () => {
      await build(undefined, '20');
      expect(await service.entryMatchTopLimit()).toBe(20);
    });

    it('sin configuración usa el tope por defecto', async () => {
      await build(undefined, '');
      expect(await service.entryMatchTopLimit()).toBe(15);
    });

    it('rechaza un tope inválido', async () => {
      await build();
      await expect(service.setEntryMatchTopLimit(0)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateEntryChallenge', () => {
    it('acepta un rival del tope hacia abajo', async () => {
      await build();
      await expect(
        service.validateEntryChallenge('nuevo', 'rival'),
      ).resolves.toMatchObject({ target: { name: 'Rival' } });
    });

    it('rechaza apuntar por encima del tope', async () => {
      await build([ingresante, { ...rival, position: 3 }]);
      await expect(
        service.validateEntryChallenge('nuevo', 'rival'),
      ).rejects.toThrow(/del puesto #15 hacia abajo/);
    });

    it('rechaza a quien no tiene partido de ingreso disponible', async () => {
      await build([{ ...ingresante, entry_match_available: false }, rival]);
      await expect(
        service.validateEntryChallenge('nuevo', 'rival'),
      ).rejects.toThrow(/No tienes un partido de ingreso/);
    });

    it('rechaza si el ingresante ya está en la escalerilla', async () => {
      await build([{ ...ingresante, position: 30 }, rival]);
      await expect(
        service.validateEntryChallenge('nuevo', 'rival'),
      ).rejects.toThrow(/reglas normales/);
    });

    it('rechaza a un rival que está fuera de la escalerilla', async () => {
      await build([ingresante, { ...rival, position: null }]);
      await expect(
        service.validateEntryChallenge('nuevo', 'rival'),
      ).rejects.toThrow(/no está en la escalerilla/);
    });

    it('rechaza a un rival inmune', async () => {
      const inmune = {
        ...rival,
        immune_until: new Date(Date.now() + 3600_000),
      };
      await build([ingresante, inmune]);
      await expect(
        service.validateEntryChallenge('nuevo', 'rival'),
      ).rejects.toThrow(/inmunidad/);
    });
  });

  describe('resultado', () => {
    const entryChallenge = {
      id: 'c1',
      type: 'entry',
      challenger_id: 'nuevo',
      challenged_id: 'rival',
    };

    it('ganar lo mete en el puesto del rival', async () => {
      await build();
      prisma.challenge.findUnique.mockResolvedValue(entryChallenge);

      const handled = await service.handleIfEntryMatch('c1', 'nuevo');

      expect(handled).toBe(true);
      expect(ladder.insertAt).toHaveBeenCalledWith(
        'nuevo',
        20,
        'entry_match_won',
      );
      expect(ladder.sendToBottom).not.toHaveBeenCalled();
    });

    it('perder lo deja último de toda la escalerilla', async () => {
      await build();
      prisma.challenge.findUnique.mockResolvedValue(entryChallenge);

      await service.handleIfEntryMatch('c1', 'rival');

      expect(ladder.sendToBottom).toHaveBeenCalledWith(
        'nuevo',
        'entry_match_lost',
      );
      expect(ladder.insertAt).not.toHaveBeenCalled();
    });

    it('gaste el resultado que sea, el derecho se consume', async () => {
      await build();
      prisma.challenge.findUnique.mockResolvedValue(entryChallenge);

      await service.handleIfEntryMatch('c1', 'rival');

      expect(prisma.player.update).toHaveBeenCalledWith({
        where: { id: 'nuevo' },
        data: { entry_match_available: false },
      });
    });

    it('no toca nada si el desafío es normal', async () => {
      await build();
      prisma.challenge.findUnique.mockResolvedValue({
        ...entryChallenge,
        type: 'normal',
      });

      const handled = await service.handleIfEntryMatch('c1', 'nuevo');

      expect(handled).toBe(false);
      expect(ladder.insertAt).not.toHaveBeenCalled();
      expect(ladder.sendToBottom).not.toHaveBeenCalled();
    });
  });

  describe('getEntryMatchTargets', () => {
    it('lista solo a los que están del tope hacia abajo y libres', async () => {
      const arriba = { ...rival, id: 'arriba', name: 'Arriba', position: 5 };
      const ocupado = {
        ...rival,
        id: 'ocupado',
        name: 'Ocupado',
        position: 22,
      };
      await build([ingresante, arriba, rival, ocupado]);
      // findMany del listado filtra por posición; se simula acá.
      prisma.player.findMany.mockResolvedValue([rival, ocupado]);
      prisma.challenge.findMany.mockResolvedValue([
        { challenger_id: 'ocupado', challenged_id: 'otro' },
      ]);

      const result = await service.getEntryMatchTargets('nuevo');

      expect(result.available).toBe(true);
      expect(result.top_limit).toBe(15);
      expect(result.targets.map((t: any) => t.id)).toEqual(['rival']);
    });

    it('responde vacío para quien no tiene partido de ingreso', async () => {
      await build([{ ...ingresante, entry_match_available: false }, rival]);

      const result = await service.getEntryMatchTargets('nuevo');

      expect(result).toMatchObject({ available: false, targets: [] });
    });
  });
});
