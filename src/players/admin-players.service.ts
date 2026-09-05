import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LadderService } from '../ladder/ladder.service';
import { AppLogger } from '../common/app.logger';
import { chileWeekBoundsFromStr, currentChileDate } from '../common/dates';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AdminPlayersService {
  constructor(
    private prisma: PrismaService,
    private appLogger: AppLogger,
    private ladder: LadderService,
  ) {}

  /**
   * Da de baja de la escalerilla al que no juega el semestre, SIN borrar nada:
   * conserva récord, historial, logros y temporadas jugadas, y los de abajo
   * suben un puesto para que no quede el hueco.
   *
   * Es lo contrario de eliminar al jugador: el día que vuelva, se reincorpora.
   */
  async retireFromLadder(id: string) {
    const result = await this.ladder.retire(id, 'left_ladder');
    this.appLogger.playerRetired(result.player, result.from, result.moved_up);
    return {
      message: `${result.player} salió de la escalerilla. Sus datos quedan guardados.`,
      ...result,
    };
  }

  /**
   * Reincorpora a un jugador retirado.
   *
   * Por defecto NO lo mete en un puesto: le habilita el partido de ingreso,
   * donde él elige rival y se gana el lugar en la cancha. Con `position` el
   * admin lo ubica directo, para los casos que no dan para partido.
   */
  async rejoinLadder(id: string, position?: number) {
    const player = await this.prisma.player.findUnique({
      where: { id },
      select: { id: true, name: true, position: true },
    });
    if (!player) throw new NotFoundException('Jugador no encontrado');
    if (player.position != null)
      throw new ConflictException(`${player.name} ya está en la escalerilla`);

    if (position != null) {
      const result = await this.ladder.insertAt(
        id,
        position,
        'rejoined_ladder',
      );
      await this.prisma.player.update({
        where: { id },
        data: { entry_match_available: false },
      });
      this.appLogger.playerRejoined(player.name, result.position);
      return {
        message: `${player.name} vuelve a la escalerilla en el puesto #${result.position}.`,
        ...result,
      };
    }

    await this.prisma.player.update({
      where: { id },
      data: { entry_match_available: true },
    });
    this.appLogger.playerRejoined(player.name, null);
    return {
      message: `${player.name} puede jugar su partido de ingreso para elegir puesto.`,
      player: player.name,
      entry_match_available: true,
    };
  }

  async createPlayer(data: {
    username: string;
    email: string;
    password: string;
    name: string;
    phone?: string;
    position?: number;
    member_type?: string;
    parent_id?: string;
    has_debt?: boolean;
    admin_role?: string | null;
    school_names?: string[];
  }) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: data.username }, { email: data.email }] },
    });

    if (existing) throw new ConflictException('Username o email ya existe');

    const password_hash = await bcrypt.hash(data.password, 10);

    // Si no tiene posición, es socio sin escalerilla (position = null)
    let position: number | null | undefined = data.position;
    if (position === undefined || position === null) {
      // Solo asignar posición automática si no es hijo y no se especificó
      position = null;
    }

    const isAdmin = !!data.admin_role;

    const user = await this.prisma.user.create({
      data: {
        username: data.username,
        email: data.email,
        password_hash,
        is_admin: isAdmin,
        admin_role: data.admin_role || null,
      },
    });

    const player = await this.prisma.player.create({
      data: {
        user_id: user.id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        position,
        // El socio nuevo que entra sin puesto se gana el suyo en la cancha:
        // elige rival del tope hacia abajo y si gana entra en ese puesto.
        // Los admins quedan fuera (no juegan la escalerilla).
        entry_match_available: position == null && !isAdmin,
        member_type: data.member_type || 'socio',
        parent_id: data.parent_id || null,
        has_debt: data.has_debt || false,
        school_names: data.school_names || [],
      },
      include: {
        user: { select: { username: true, is_admin: true, admin_role: true } },
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true } },
      },
    });

    this.appLogger.playerCreated(
      player.name,
      data.member_type || 'socio',
      data.admin_role || undefined,
    );
    return player;
  }

  async updatePlayer(
    id: string,
    data: {
      name?: string;
      email?: string;
      phone?: string;
      position?: number | null;
      wins?: number;
      losses?: number;
      total_matches?: number;
      immune_until?: string | null;
      vulnerable_until?: string | null;
      member_type?: string;
      parent_id?: string | null;
      has_debt?: boolean;
      admin_role?: string | null;
      extra_high_demand_slots?: number;
      school_names?: string[];
    },
  ) {
    const player = await this.prisma.player.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!player) throw new NotFoundException('Jugador no encontrado');

    const playerUpdate: any = {};
    const userUpdate: any = {};

    if (data.name !== undefined) playerUpdate.name = data.name;
    if (data.email !== undefined) playerUpdate.email = data.email;
    if (data.phone !== undefined) playerUpdate.phone = data.phone;
    if (data.position !== undefined) {
      playerUpdate.position = data.position;
      // Si el admin lo ubica a mano, ya no le queda partido de ingreso: el
      // puesto se lo dieron, no lo jugó.
      if (data.position !== null) playerUpdate.entry_match_available = false;
    }
    if (data.wins !== undefined) playerUpdate.wins = data.wins;
    if (data.losses !== undefined) playerUpdate.losses = data.losses;
    if (data.total_matches !== undefined)
      playerUpdate.total_matches = data.total_matches;
    if (data.member_type !== undefined)
      playerUpdate.member_type = data.member_type;
    if (data.parent_id !== undefined)
      playerUpdate.parent_id = data.parent_id || null;
    if (data.has_debt !== undefined) playerUpdate.has_debt = data.has_debt;
    if (data.extra_high_demand_slots !== undefined)
      playerUpdate.extra_high_demand_slots = data.extra_high_demand_slots;
    if (data.school_names !== undefined)
      playerUpdate.school_names = data.school_names;
    if (data.immune_until !== undefined) {
      playerUpdate.immune_until = data.immune_until
        ? new Date(data.immune_until)
        : null;
    }
    if (data.vulnerable_until !== undefined) {
      playerUpdate.vulnerable_until = data.vulnerable_until
        ? new Date(data.vulnerable_until)
        : null;
    }

    // Actualizar admin_role en User
    if (data.admin_role !== undefined) {
      userUpdate.admin_role = data.admin_role || null;
      userUpdate.is_admin = !!data.admin_role;
    }

    if (Object.keys(userUpdate).length > 0) {
      await this.prisma.user.update({
        where: { id: player.user_id },
        data: userUpdate,
      });
    }

    const result = this.prisma.player.update({
      where: { id },
      data: playerUpdate,
      include: {
        user: { select: { username: true, is_admin: true, admin_role: true } },
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true } },
      },
    });
    const changes = Object.keys(playerUpdate)
      .concat(Object.keys(userUpdate))
      .join(', ');
    this.appLogger.playerUpdated(player.name, changes);
    return result;
  }

  async deletePlayer(id: string) {
    const player = await this.prisma.player.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!player) throw new NotFoundException('Jugador no encontrado');
    await this.prisma.user.delete({ where: { id: player.user_id } });
    return { message: 'Jugador eliminado correctamente' };
  }

  async movePlayer(id: string, newPosition: number) {
    const player = await this.prisma.player.findUnique({ where: { id } });
    if (!player) throw new NotFoundException('Jugador no encontrado');

    const oldPosition = player.position;

    if (newPosition < (oldPosition ?? 0)) {
      await this.prisma.player.updateMany({
        where: { position: { gte: newPosition, lt: oldPosition ?? 0 } },
        data: { position: { increment: 1 } },
      });
    } else if (newPosition > (oldPosition ?? 0)) {
      await this.prisma.player.updateMany({
        where: { position: { gt: oldPosition ?? 0, lte: newPosition } },
        data: { position: { decrement: 1 } },
      });
    }

    const updated = await this.prisma.player.update({
      where: { id },
      data: { position: newPosition },
      include: {
        user: { select: { username: true, is_admin: true, admin_role: true } },
      },
    });

    await this.prisma.rankingHistory.create({
      data: {
        player_id: id,
        position: newPosition,
        old_position: oldPosition,
        reason: 'Movimiento manual por administrador',
      },
    });

    return updated;
  }

  async getAllPlayers() {
    return this.prisma.player.findMany({
      include: {
        user: { select: { username: true, is_admin: true, admin_role: true } },
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async resetImmunity(id: string) {
    return this.prisma.player.update({
      where: { id },
      data: { immune_until: null },
    });
  }

  async resetVulnerability(id: string) {
    return this.prisma.player.update({
      where: { id },
      data: { vulnerable_until: null },
    });
  }

  /**
   * Cupos de alta demanda usados esta semana — misma lógica que el cobro real
   * (ReservationsService.checkHighDemandLimit): semana Chile, cancelaciones
   * tardías cuentan, extra_high_demand_slots amplía el límite.
   */
  async getWeeklyHighDemandUsage(playerId: string) {
    const { weekStart, weekEnd } = chileWeekBoundsFromStr(currentChileDate());

    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { children: { select: { id: true, name: true } } },
    });
    if (!player) throw new NotFoundException('Jugador no encontrado');

    const playerIds = [playerId, ...(player.children?.map((c) => c.id) || [])];

    const used = await this.prisma.reservation.count({
      where: {
        player_id: { in: playerIds },
        is_high_demand: true,
        date: { gte: weekStart, lte: weekEnd },
        OR: [
          { status: 'active' },
          {
            status: 'cancelled',
            cancel_reason: 'Cancelación tardía - turno descontado',
          },
        ],
      },
    });

    const extraSlots = player.extra_high_demand_slots ?? 0;
    const limit =
      player.member_type === 'hijo_socio'
        ? 1
        : 2 + (player.children?.length || 0) + extraSlots;

    return {
      player_id: playerId,
      member_type: player.member_type,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      week_start: weekStart,
      week_end: weekEnd,
    };
  }
}
