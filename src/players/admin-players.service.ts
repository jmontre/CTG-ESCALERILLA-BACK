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
      include: { player: { select: { name: true, deactivated_at: true } } },
    });

    if (existing?.player?.deactivated_at)
      throw new ConflictException(
        `Ese username o email es de la cuenta de ${existing.player.name}, que está ` +
          `dada de baja. Restáurala en vez de crear una nueva: vuelve con su récord ` +
          `y su historial.`,
      );
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

  /**
   * Da de baja la cuenta de un socio. **Es un soft delete: se deshace.**
   *
   * No se borra ni se pisa NADA — nombre, email, teléfono, avatar, contraseña,
   * récord e historial quedan tal cual. Lo único que cambia es `deactivated_at`
   * (que lo saca de todos los listados y le bloquea el login) y la salida de la
   * escalerilla, compactando los puestos.
   *
   * Así el día que el socio vuelve, `restorePlayer` lo devuelve entero, con su
   * misma cuenta y su misma contraseña.
   *
   * Borrar de verdad no es opción: `challenges` y `master_matches` referencian
   * a los DOS jugadores, así que llevárselos borraría también el historial del
   * rival y descuadraría el fixture. Antes esto ni siquiera llegaba a pasar —
   * la FK lo bloqueaba y el endpoint devolvía 500.
   */
  async deletePlayer(id: string) {
    const player = await this.prisma.player.findUnique({ where: { id } });
    if (!player) throw new NotFoundException('Jugador no encontrado');
    if (player.deactivated_at)
      throw new ConflictException(`${player.name} ya está dado de baja`);

    const huella = await this.footprint(id);

    // Sale de la escalerilla primero: deja las posiciones compactadas.
    if (player.position != null) await this.ladder.retire(id, 'account_closed');

    await this.prisma.player.update({
      where: { id },
      data: {
        deactivated_at: new Date(),
        // Lo único que se apaga además de la baja: no tiene sentido guardarle
        // un partido de ingreso pendiente a una cuenta cerrada.
        entry_match_available: false,
      },
    });

    this.appLogger.playerDeactivated(player.name, huella);
    const jugados = huella.challenges + huella.masterMatches;
    return {
      message:
        `${player.name} fue dado de baja: ya no aparece en la app ni puede entrar. ` +
        (jugados > 0
          ? `Sus ${jugados} partido(s) siguen en el historial del club a su nombre. `
          : '') +
        `No se borró nada: si vuelve, lo restauras con su misma cuenta.`,
      mode: 'deactivated' as const,
      footprint: huella,
    };
  }

  /** Los dados de baja, para el panel. Es la única vista que los muestra. */
  async getDeactivatedPlayers() {
    return this.prisma.player.findMany({
      where: { deactivated_at: { not: null } },
      orderBy: { deactivated_at: 'desc' },
      include: {
        user: { select: { username: true, is_admin: true, admin_role: true } },
      },
    });
  }

  /**
   * Deshace la baja: el socio vuelve con su cuenta, su contraseña y su récord
   * intactos. Queda FUERA de la escalerilla, como cualquier reincorporación:
   * el puesto se lo da el admin o se lo gana en su partido de ingreso.
   */
  async restorePlayer(id: string) {
    const player = await this.prisma.player.findUnique({ where: { id } });
    if (!player) throw new NotFoundException('Jugador no encontrado');
    if (!player.deactivated_at)
      throw new ConflictException(`${player.name} no está dado de baja`);

    await this.prisma.player.update({
      where: { id },
      data: { deactivated_at: null },
    });
    this.appLogger.playerRestored(player.name);

    return {
      message:
        `${player.name} vuelve a estar activo, con su cuenta y su récord de siempre. ` +
        `Queda fuera de la escalerilla: reincorpóralo para darle un puesto.`,
      player: player.name,
    };
  }

  /**
   * Borrado definitivo. Solo para cuentas ya dadas de baja y **sin ningún
   * rastro** — la creada por error, con el nombre mal escrito.
   *
   * La guarda no es paranoia: con un solo partido jugado, borrar esta fila se
   * lleva el desafío del historial del rival. Por eso el camino normal es la
   * baja, y esto es la excepción para limpiar basura.
   */
  async purgePlayer(id: string) {
    const player = await this.prisma.player.findUnique({ where: { id } });
    if (!player) throw new NotFoundException('Jugador no encontrado');
    if (!player.deactivated_at)
      throw new ConflictException(
        `Primero da de baja a ${player.name}. El borrado definitivo es solo para ` +
          `cuentas ya dadas de baja.`,
      );

    const huella = await this.footprint(id);
    const jugados = Object.values(huella).reduce((a, b) => a + b, 0);
    if (jugados > 0)
      throw new ConflictException(
        `${player.name} no se puede borrar: tiene ${huella.challenges} desafío(s), ` +
          `${huella.masterMatches} partido(s) de Master y ${huella.reservations} reserva(s) ` +
          `que también están en el historial de otros socios. Déjalo dado de baja.`,
      );

    await this.prisma.$transaction([
      this.prisma.notification.deleteMany({ where: { player_id: id } }),
      this.prisma.rankingHistory.deleteMany({ where: { player_id: id } }),
      this.prisma.user.delete({ where: { id: player.user_id } }),
    ]);
    this.appLogger.playerDeleted(player.name);
    return { message: `${player.name} fue eliminado definitivamente.` };
  }

  /** Qué dejó este jugador en la base. Cero en todo = cuenta sin rastro. */
  private async footprint(playerId: string) {
    const [challenges, masterMatches, reservations, standings] =
      await Promise.all([
        this.prisma.challenge.count({
          where: {
            OR: [{ challenger_id: playerId }, { challenged_id: playerId }],
          },
        }),
        this.prisma.masterMatch.count({
          where: { OR: [{ player1_id: playerId }, { player2_id: playerId }] },
        }),
        this.prisma.reservation.count({ where: { player_id: playerId } }),
        this.prisma.seasonStanding.count({ where: { player_id: playerId } }),
      ]);
    return { challenges, masterMatches, reservations, standings };
  }

  /**
   * Mueve un jugador a un puesto concreto. Delega en `LadderService.insertAt`,
   * que hace el corrimiento en una transacción y deja historial de TODOS los
   * que se movieron — antes tenía su propia lógica con `updateMany`, fuera de
   * transacción y anotando solo al jugador movido.
   */
  async movePlayer(id: string, newPosition: number) {
    const player = await this.prisma.player.findUnique({ where: { id } });
    if (!player) throw new NotFoundException('Jugador no encontrado');

    const oldPosition = player.position;
    await this.ladder.insertAt(id, newPosition, 'admin_move');
    this.appLogger.playerMoved(player.name, oldPosition ?? 0, newPosition);

    return this.prisma.player.findUnique({
      where: { id },
      include: {
        user: { select: { username: true, is_admin: true, admin_role: true } },
      },
    });
  }

  /**
   * Reordena la escalerilla completa de una sola vez, con el orden que el
   * admin armó arrastrando en el panel.
   *
   * Exige la lista COMPLETA y exacta de los que hoy están en la escalerilla:
   * aceptar una lista parcial dejaría fuera a quien no viniera en ella, y una
   * pantalla desactualizada (otro admin movió a alguien, o un desafío se
   * resolvió mientras tanto) borraría ese cambio sin avisar.
   */
  async reorderLadder(playerIds: string[]) {
    const actuales = await this.ladder.ordered();

    if (playerIds.length !== new Set(playerIds).size)
      throw new ConflictException('La lista trae jugadores repetidos');

    const enviados = new Set(playerIds);
    const faltan = actuales.filter((p) => !enviados.has(p.id));
    const sobran = playerIds.filter(
      (id) => !actuales.some((p) => p.id === id),
    );

    if (faltan.length > 0 || sobran.length > 0)
      throw new ConflictException(
        'La escalerilla cambió mientras editabas. Recarga el panel y vuelve a ordenarla. ' +
          (faltan.length > 0
            ? `Faltan en tu lista: ${faltan.map((p) => p.name).join(', ')}. `
            : '') +
          (sobran.length > 0
            ? `Ya no están en la escalerilla: ${sobran.length}.`
            : ''),
      );

    const result = await this.ladder.applyOrder(playerIds, 'admin_reorder');
    this.appLogger.ladderReordered(result.moved, result.total);
    return {
      message:
        result.moved === 0
          ? 'No hubo cambios que guardar.'
          : `Escalerilla actualizada: ${result.moved} jugador(es) cambiaron de puesto.`,
      ...result,
    };
  }

  async getAllPlayers() {
    return this.prisma.player.findMany({
      // Los dados de baja desaparecen del panel; sus partidos siguen en el
      // historial del club, con su nombre.
      where: { deactivated_at: null },
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
