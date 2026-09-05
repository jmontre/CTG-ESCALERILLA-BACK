import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Escrituras sobre el orden de la escalerilla: entrar, salir, insertar en un
 * puesto y reordenar tramos completos.
 *
 * Vive aparte de `ChallengeRulesService` (que mueve puestos por resultado de
 * un desafío) porque estas operaciones no nacen de un partido: son la baja del
 * que no juega el semestre, la reincorporación del que vuelve, y el
 * reordenamiento por el Master al cerrar la temporada.
 *
 * Regla común a todos los métodos: las posiciones quedan sin huecos. Poner
 * `position = null` a mano dejaba la escalerilla numerada 1,2,4,5 y de ahí en
 * adelante los niveles de la pirámide salían corridos.
 */
@Injectable()
export class LadderService {
  constructor(private prisma: PrismaService) {}

  /** Último puesto ocupado. 0 si no hay nadie en la escalerilla. */
  async size(): Promise<number> {
    const last = await this.prisma.player.findFirst({
      where: { position: { gte: 1, lt: 1000 } },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last?.position ?? 0;
  }

  /** Jugadores de la escalerilla ordenados por puesto (sin admins ni retirados). */
  async ordered() {
    return this.prisma.player.findMany({
      where: { position: { gte: 1, lt: 1000 } },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, position: true },
    });
  }

  /**
   * Saca a un jugador de la escalerilla conservando todos sus datos
   * (récord, historial, logros, temporadas jugadas). Los de abajo suben uno
   * para que no quede el hueco.
   */
  async retire(playerId: string, reason = 'left_ladder') {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true, name: true, position: true },
    });
    if (!player) throw new NotFoundException('Jugador no encontrado');
    if (player.position == null)
      throw new BadRequestException(`${player.name} ya está fuera de la escalerilla`);

    const from = player.position;
    const below = await this.prisma.player.findMany({
      where: { position: { gt: from, lt: 1000 } },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });

    await this.prisma.$transaction([
      this.prisma.player.update({
        where: { id: playerId },
        data: { position: null },
      }),
      ...below.map((p) =>
        this.prisma.rankingHistory.create({
          data: {
            player_id: p.id,
            old_position: p.position,
            position: p.position! - 1,
            reason,
          },
        }),
      ),
      // Ascendente: la posición liberada va corriendo hacia abajo, así que
      // cada update entra a un puesto que acaba de quedar vacío.
      ...below.map((p) =>
        this.prisma.player.update({
          where: { id: p.id },
          data: { position: p.position! - 1 },
        }),
      ),
    ]);

    return { player: player.name, from, moved_up: below.length };
  }

  /**
   * Mete a un jugador en un puesto concreto: el que lo ocupaba y todos los de
   * abajo bajan uno. Sirve para la reincorporación directa y para el partido
   * de ingreso ganado.
   */
  async insertAt(playerId: string, position: number, reason: string) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true, name: true, position: true },
    });
    if (!player) throw new NotFoundException('Jugador no encontrado');

    // Si ya estaba en la escalerilla, primero se lo saca para no contarlo dos
    // veces al correr al resto. El tamaño se mide DESPUÉS de sacarlo, o el
    // tope quedaría corrido en uno.
    if (player.position != null) await this.retire(playerId, reason);

    const size = await this.size();
    const target = Math.max(1, Math.min(position, size + 1));

    const below = await this.prisma.player.findMany({
      where: { position: { gte: target, lt: 1000 } },
      orderBy: { position: 'desc' },
      select: { id: true, position: true },
    });

    await this.prisma.$transaction([
      ...below.map((p) =>
        this.prisma.rankingHistory.create({
          data: {
            player_id: p.id,
            old_position: p.position,
            position: p.position! + 1,
            reason,
          },
        }),
      ),
      // Descendente: se libera primero el último puesto.
      ...below.map((p) =>
        this.prisma.player.update({
          where: { id: p.id },
          data: { position: p.position! + 1 },
        }),
      ),
      this.prisma.rankingHistory.create({
        data: {
          player_id: playerId,
          old_position: player.position,
          position: target,
          reason,
        },
      }),
      this.prisma.player.update({
        where: { id: playerId },
        data: { position: target },
      }),
    ]);

    return { player: player.name, position: target, moved_down: below.length };
  }

  /** Lo deja último de toda la escalerilla. */
  async sendToBottom(playerId: string, reason: string) {
    const size = await this.size();
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { position: true },
    });
    // Si ya estaba dentro, el último puesto libre es el que tiene hoy.
    const target = player?.position != null ? size : size + 1;
    return this.insertAt(playerId, target, reason);
  }

  /**
   * Reescribe el orden completo de la escalerilla a partir de una lista de ids.
   * Los ids que no aparecen quedan fuera del alcance del reordenamiento (no se
   * tocan), así que la lista debe traer a TODOS los que están dentro.
   *
   * Va en una sola transacción: una escalerilla a medio reordenar es peor que
   * una sin reordenar.
   */
  async applyOrder(orderedIds: string[], reason: string) {
    const current = await this.ordered();
    const byId = new Map(current.map((p) => [p.id, p]));

    const writes: any[] = [];
    let moved = 0;
    orderedIds.forEach((id, index) => {
      const player = byId.get(id);
      const position = index + 1;
      if (!player || player.position === position) return;
      moved++;
      writes.push(
        this.prisma.rankingHistory.create({
          data: {
            player_id: id,
            old_position: player.position,
            position,
            reason,
          },
        }),
        this.prisma.player.update({ where: { id }, data: { position } }),
      );
    });

    if (writes.length > 0) await this.prisma.$transaction(writes);
    return { total: orderedIds.length, moved };
  }
}
