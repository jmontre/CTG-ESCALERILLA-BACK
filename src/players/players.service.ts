import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChallengeRulesService } from '../challenges/challenge-rules.service';
import { uploadAvatar, deleteAvatar } from './cloudinary.service';
import * as bcrypt from 'bcryptjs';

// Allowlist de campos para GET /players/:id.
// Añadir un campo aquí es una decisión consciente de exposición.
export const PUBLIC_PLAYER_SELECT = {
  id: true,
  name: true,
  avatar_url: true,
  position: true,
  wins: true,
  losses: true,
  total_matches: true,
  immune_until: true,
  vulnerable_until: true,
  member_type: true,
  school_names: true,
  created_at: true,
  user: { select: { username: true, is_admin: true } },
  challenges_made: {
    orderBy: { created_at: 'desc' as const },
    take: 10,
    select: {
      id: true,
      status: true,
      created_at: true,
      play_deadline: true,
      resolved_at: true,
      challenged: { select: { name: true, position: true } },
    },
  },
  challenges_received: {
    orderBy: { created_at: 'desc' as const },
    take: 10,
    select: {
      id: true,
      status: true,
      created_at: true,
      play_deadline: true,
      resolved_at: true,
      challenger: { select: { name: true, position: true } },
    },
  },
  ranking_history: {
    orderBy: { created_at: 'desc' as const },
    take: 20,
  },
} satisfies Prisma.PlayerSelect;

// Propietario y admin reciben adicionalmente todos los campos PII.
export const FULL_PLAYER_SELECT = {
  ...PUBLIC_PLAYER_SELECT,
  email: true,
  phone: true,
  has_debt: true,
  user_id: true,
  parent_id: true,
  extra_high_demand_slots: true,
  user: { select: { username: true, email: true, is_admin: true } },
} satisfies Prisma.PlayerSelect;

@Injectable()
export class PlayersService {
  constructor(
    private prisma: PrismaService,
    private challengeRules: ChallengeRulesService,
  ) {}

  async findAll() {
    // Endpoint público (@Public): se exponen solo campos no sensibles.
    // NO incluir email, phone ni has_debt (datos personales de socios).
    const players = await this.prisma.player.findMany({
      orderBy: { position: 'asc' },
      select: {
        id: true,
        user_id: true,
        name: true,
        avatar_url: true,
        position: true,
        wins: true,
        losses: true,
        total_matches: true,
        immune_until: true,
        vulnerable_until: true,
        member_type: true,
        parent_id: true,
        created_at: true,
        extra_high_demand_slots: true,
        school_names: true,
        user: {
          select: { username: true, is_admin: true, admin_role: true },
        },
        challenges_made: {
          where: { status: { in: ['pending', 'accepted'] } },
          orderBy: { created_at: 'desc' },
          take: 1,
          include: {
            challenged: { select: { id: true, name: true, position: true } },
          },
        },
        challenges_received: {
          where: { status: { in: ['pending', 'accepted'] } },
          orderBy: { created_at: 'desc' },
          take: 1,
          include: {
            challenger: { select: { id: true, name: true, position: true } },
          },
        },
      },
    });

    return players
      .filter((p) => !p.user?.is_admin) // ← excluir admins
      .map((p) => ({
        ...p,
        is_admin: p.user?.is_admin || false,
        admin_role: p.user?.admin_role || null,
        challenger_challenge: p.challenges_made[0] || null,
        challenged_challenge: p.challenges_received[0] || null,
      }));
  }

  async findOne(id: string, requester: { sub: string; is_admin: boolean }) {
    // Consulta mínima para determinar propiedad antes de elegir el select.
    const owner = await this.prisma.player.findUnique({
      where: { id },
      select: { user_id: true },
    });
    if (!owner) throw new NotFoundException('Jugador no encontrado');

    const isSelfOrAdmin = owner.user_id === requester.sub || requester.is_admin;

    const player = await this.prisma.player.findUnique({
      where: { id },
      select: isSelfOrAdmin ? FULL_PLAYER_SELECT : PUBLIC_PLAYER_SELECT,
    });
    if (!player) throw new NotFoundException('Jugador no encontrado');

    return { ...player, is_admin: player.user?.is_admin || false };
  }

  async findByUserId(userId: string) {
    const player = await this.prisma.player.findUnique({
      where: { user_id: userId },
      include: {
        user: { select: { username: true, email: true, is_admin: true } },
      },
    });

    if (!player)
      throw new NotFoundException(
        `Jugador con user_id ${userId} no encontrado`,
      );

    return { ...player, is_admin: player.user?.is_admin || false };
  }

  async getAvailableChallenges(id: string) {
    const availablePlayers =
      await this.challengeRules.getAvailableChallenges(id);
    // El nivel es la fila de la pirámide, y el reparto de filas de la última
    // categoría depende de cuántos jugadores hay.
    const size = await this.challengeRules.ladderSize();

    return {
      player_id: id,
      available_challenges: availablePlayers.map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        level: this.challengeRules.getLevel(p.position!, size),
        wins: p.wins,
        losses: p.losses,
      })),
    };
  }

  /**
   * Actualizar perfil del jugador autenticado
   */
  async updateMe(
    userId: string,
    data: {
      name?: string;
      phone?: string;
      current_password?: string;
      new_password?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { player: true },
    });

    if (!user || !user.player)
      throw new NotFoundException('Jugador no encontrado');

    const playerUpdate: any = {};
    const userUpdate: any = {};

    if (data.name?.trim()) playerUpdate.name = data.name.trim();
    if (data.phone !== undefined) playerUpdate.phone = data.phone || null;

    // Cambio de contraseña
    if (data.new_password) {
      if (!data.current_password) {
        throw new BadRequestException(
          'Debes ingresar tu contraseña actual para cambiarla.',
        );
      }
      const isValid = await bcrypt.compare(
        data.current_password,
        user.password_hash,
      );
      if (!isValid) {
        throw new BadRequestException('La contraseña actual es incorrecta.');
      }
      if (data.new_password.length < 6) {
        throw new BadRequestException(
          'La nueva contraseña debe tener al menos 6 caracteres.',
        );
      }
      userUpdate.password_hash = await bcrypt.hash(data.new_password, 10);
    }

    if (Object.keys(playerUpdate).length > 0) {
      await this.prisma.player.update({
        where: { id: user.player.id },
        data: playerUpdate,
      });
    }

    if (Object.keys(userUpdate).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: userUpdate,
      });
    }

    // Retornar player actualizado
    const updated = await this.prisma.player.findUnique({
      where: { id: user.player.id },
      include: {
        user: { select: { username: true, email: true, is_admin: true } },
      },
    });

    return {
      message: 'Perfil actualizado correctamente.',
      player: { ...updated, is_admin: updated?.user?.is_admin || false },
    };
  }

  /**
   * Subir avatar a Cloudinary
   */
  async uploadAvatar(userId: string, base64Image: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { player: true },
    });

    if (!user || !user.player)
      throw new NotFoundException('Jugador no encontrado');

    const avatarUrl = await uploadAvatar(base64Image, user.player.id);

    await this.prisma.player.update({
      where: { id: user.player.id },
      data: { avatar_url: avatarUrl },
    });

    return {
      message: 'Avatar actualizado correctamente.',
      avatar_url: avatarUrl,
    };
  }

  async deleteAvatar(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { player: true },
    });

    if (!user || !user.player)
      throw new NotFoundException('Jugador no encontrado');

    await deleteAvatar(user.player.id);

    await this.prisma.player.update({
      where: { id: user.player.id },
      data: { avatar_url: null },
    });

    return { message: 'Foto eliminada correctamente.' };
  }
}
