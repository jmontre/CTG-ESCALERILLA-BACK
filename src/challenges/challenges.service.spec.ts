import { BadRequestException } from '@nestjs/common';
import { ChallengesService } from './challenges.service';

jest.mock('../notifications/whatsapp.service', () => ({
  whatsappService: {
    sendMessage: jest.fn(),
    sendGroupMessage: jest.fn(),
    sendAcceptedNotification: jest.fn(),
    sendChallengeNotification: jest.fn(),
  },
}));
jest.mock('../notifications/email.service', () => ({
  emailService: {
    sendAcceptedNotification: jest.fn(),
    sendChallengeNotification: jest.fn(),
  },
}));

describe('ChallengesService.accept', () => {
  const basePlayers = {
    challenger: { id: 'p1', name: 'Uno', email: 'a@a.cl', phone: null },
    challenged: { id: 'p2', name: 'Dos', email: 'b@b.cl', phone: null },
  };

  function build(updateManyCount: number) {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const challenge = {
      id: 'c1',
      challenger_id: 'p1',
      challenged_id: 'p2',
      status: 'pending',
      accept_deadline: future,
      ...basePlayers,
    };
    const prisma: any = {
      challenge: {
        findUnique: jest.fn().mockResolvedValue(challenge),
        updateMany: jest.fn().mockResolvedValue({ count: updateManyCount }),
      },
    };
    const appLogger: any = { challengeAccepted: jest.fn() };
    const rules: any = {};
    const notificationsService: any = { create: jest.fn() };
    const achievements: any = { evaluateAfterChallenge: jest.fn() };
    return {
      service: new ChallengesService(
        prisma,
        rules,
        appLogger,
        notificationsService,
        achievements,
      ),
      prisma,
      notificationsService,
    };
  }

  it('falla si otro proceso ya cambió el estado (claim count 0)', async () => {
    const { service } = build(0);
    await expect(service.accept('c1', 'p2')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('acepta cuando el claim gana (count 1)', async () => {
    const { service, prisma } = build(1);
    const result = await service.accept('c1', 'p2');
    expect(result.message).toContain('aceptado');
    expect(prisma.challenge.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'pending' },
      data: expect.objectContaining({ status: 'accepted' }),
    });
  });
});
