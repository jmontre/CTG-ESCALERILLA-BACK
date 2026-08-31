import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';
import { categoryOf, CategoryScheme } from '../common/ladder';
import { buildPeriods } from '../common/periods';
import { NotificationsService } from '../notifications/notifications.service';
import { ACHIEVEMENTS_BY_CODE } from '../achievements/achievements.catalog';

/**
 * Ciclo de vida de una temporada de la escalerilla (un semestre).
 *
 *   openSeason()  → crea la temporada y congela la posición INICIAL de cada
 *                   jugador (base de los logros Escalador y Ascenso).
 *   closeSeason() → congela posición final, récord y resultado del Master de
 *                   cada jugador, y otorga campeón/finalista/semifinalista.
 *
 * El histórico vive en `season_standings`: la escalerilla se puede reordenar
 * por completo sin perder lo que pasó antes.
 */
@Injectable()
export class SeasonsService {
  constructor(
    private prisma: PrismaService,
    private achievements: AchievementsService,
    private notifications: NotificationsService,
  ) {}

  /** Jugadores que participan de la escalerilla (excluye admins y sin posición). */
  private activeLadderWhere() {
    return {
      position: { gte: 1, lt: 1000 },
      user: { is_admin: false },
    };
  }

  /** Períodos (todo / año / temporada) con sus rangos. Ver common/periods.ts. */
  async periods() {
    const seasons = await this.prisma.season.findMany({
      orderBy: { started_at: 'asc' },
    });
    return buildPeriods(seasons);
  }

  async findAll() {
    return this.prisma.season.findMany({ orderBy: { started_at: 'desc' } });
  }

  /**
   * Abre una temporada y registra la posición inicial de cada jugador.
   * Idempotente: reejecutarla sobre la misma temporada refresca las posiciones
   * iniciales sin duplicar filas.
   */
  async openSeason(
    slug: string,
    name: string,
    categoryScheme: CategoryScheme = 'v2',
  ) {
    const active = await this.prisma.season.findFirst({
      where: { status: 'active' },
    });
    if (active && active.slug !== slug) {
      throw new BadRequestException(
        `La temporada "${active.slug}" sigue abierta. Ciérrala antes de abrir "${slug}".`,
      );
    }

    const season = await this.prisma.season.upsert({
      where: { slug },
      update: { name, status: 'active', category_scheme: categoryScheme },
      create: { slug, name, status: 'active', category_scheme: categoryScheme },
    });

    const players = await this.prisma.player.findMany({
      where: this.activeLadderWhere(),
      select: { id: true, position: true },
    });

    for (const p of players) {
      await this.prisma.seasonStanding.upsert({
        where: {
          season_id_player_id: { season_id: season.id, player_id: p.id },
        },
        update: {
          start_position: p.position,
          category: categoryOf(p.position, categoryScheme),
        },
        create: {
          season_id: season.id,
          player_id: p.id,
          start_position: p.position,
          category: categoryOf(p.position, categoryScheme),
        },
      });
    }

    return { season, players: players.length };
  }

  /**
   * Cierra la temporada: congela el standing de todos y otorga los logros del
   * cuadro Master cuyo `name` coincide con `masterSeasonName`.
   *
   * Los logros se otorgan en modo silencioso (ya marcados como vistos): la
   * celebración la hace el modal de resumen de temporada, no 50 notificaciones.
   */
  async closeSeason(slug: string, masterSeasonName: string) {
    const season = await this.prisma.season.findUnique({ where: { slug } });
    if (!season) throw new NotFoundException(`Temporada "${slug}" no existe`);

    // Se congela con los rangos con los que SE JUGÓ esa temporada, no con los
    // vigentes: el 1er semestre 2026 tuvo 4 categorías y sus campeones de D
    // quedarían archivados en C si se usaran los rangos nuevos.
    const scheme = (season.category_scheme ?? 'v2') as CategoryScheme;

    const players = await this.prisma.player.findMany({
      where: this.activeLadderWhere(),
      select: {
        id: true,
        position: true,
        wins: true,
        losses: true,
        total_matches: true,
      },
    });

    for (const p of players) {
      await this.prisma.seasonStanding.upsert({
        where: {
          season_id_player_id: { season_id: season.id, player_id: p.id },
        },
        update: {
          final_position: p.position,
          wins: p.wins,
          losses: p.losses,
          total_matches: p.total_matches,
          category: categoryOf(p.position, scheme),
        },
        create: {
          season_id: season.id,
          player_id: p.id,
          // Sin apertura previa no sabemos dónde partió: null, no la final.
          // Copiarla haría que el resumen mostrara "subiste 0 puestos".
          start_position: null,
          final_position: p.position,
          wins: p.wins,
          losses: p.losses,
          total_matches: p.total_matches,
          category: categoryOf(p.position, scheme),
        },
      });
    }

    const podium = await this.applyMasterResults(
      season.id,
      slug,
      masterSeasonName,
    );

    const closed = await this.prisma.season.update({
      where: { id: season.id },
      data: { status: 'closed', closed_at: new Date() },
    });

    // Aviso a todo el club con los campeones de cada categoría.
    const notified = await this.notifyPodium(slug);

    return {
      season: closed,
      standings: players.length,
      ...podium,
      notified: notified.sent,
    };
  }

  /**
   * Lee el cuadro Master de la temporada y marca campeón / finalista /
   * semifinalista en el standing, otorgando el logro correspondiente.
   */
  private async applyMasterResults(
    seasonId: string,
    slug: string,
    masterSeasonName: string,
  ) {
    const masterSeasons = await this.prisma.masterSeason.findMany({
      where: { name: masterSeasonName },
      include: {
        matches: {
          where: { round: { in: ['semifinal', 'final'] } },
          select: {
            round: true,
            status: true,
            player1_id: true,
            player2_id: true,
            winner_id: true,
          },
        },
      },
    });

    const champions: Array<{ category: string; player_id: string }> = [];
    const finalists: Array<{ category: string; player_id: string }> = [];
    const semifinalists: Array<{ category: string; player_id: string }> = [];

    for (const ms of masterSeasons) {
      const final = ms.matches.find((m) => m.round === 'final');
      const semis = ms.matches.filter((m) => m.round === 'semifinal');

      for (const s of semis) {
        if (s.status !== 'completed') continue;
        for (const pid of [s.player1_id, s.player2_id]) {
          semifinalists.push({ category: ms.category, player_id: pid });
        }
      }

      if (final?.status === 'completed' && final.winner_id) {
        const loserId =
          final.winner_id === final.player1_id
            ? final.player2_id
            : final.player1_id;
        champions.push({ category: ms.category, player_id: final.winner_id });
        finalists.push({ category: ms.category, player_id: loserId });
      }
    }

    // Un jugador podría figurar en varias listas: gana la distinción más alta.
    const best = new Map<string, { result: string; category: string }>();
    const rank: Record<string, number> = {
      semifinalist: 1,
      finalist: 2,
      champion: 3,
    };
    const record = (list: typeof champions, result: string) => {
      for (const { player_id, category } of list) {
        const cur = best.get(player_id);
        if (!cur || rank[result] > rank[cur.result])
          best.set(player_id, { result, category });
      }
    };
    record(semifinalists, 'semifinalist');
    record(finalists, 'finalist');
    record(champions, 'champion');

    // Campeón y finalista también se llevan la de semifinalista: llegaron ahí.
    const CODES: Record<string, string[]> = {
      champion: ['campeon', 'semifinalista'],
      finalist: ['finalista', 'semifinalista'],
      semifinalist: ['semifinalista'],
    };

    for (const [playerId, { result, category }] of best) {
      await this.prisma.seasonStanding.updateMany({
        where: { season_id: seasonId, player_id: playerId },
        data: { master_result: result },
      });
      for (const code of CODES[result]) {
        await this.achievements.grant(playerId, code, {
          seasonSlug: slug,
          context: { categoria: category },
          silent: true,
        });
      }
    }

    return {
      champions: champions.length,
      finalists: finalists.length,
      semifinalists: new Set(semifinalists.map((s) => s.player_id)).size,
    };
  }

  /**
   * Podio de la temporada: campeón y finalista de cada categoría.
   * Lo ve TODO el club, no solo quienes lo ganaron — el cierre de temporada es
   * del club entero, y si solo se felicitara a los campeones el resto ni se
   * enteraría de quién ganó.
   */
  async podium(seasonId: string) {
    const standings = await this.prisma.seasonStanding.findMany({
      where: {
        season_id: seasonId,
        master_result: { in: ['champion', 'finalist'] },
      },
      include: {
        player: { select: { id: true, name: true, avatar_url: true } },
      },
      orderBy: { category: 'asc' },
    });

    const byCategory = new Map<
      string,
      { category: string; champion: string | null; finalist: string | null }
    >();
    for (const s of standings) {
      const cat = s.category ?? '—';
      const row = byCategory.get(cat) ?? {
        category: cat,
        champion: null,
        finalist: null,
      };
      if (s.master_result === 'champion') row.champion = s.player.name;
      else row.finalist = s.player.name;
      byCategory.set(cat, row);
    }
    return [...byCategory.values()].sort((a, b) =>
      a.category.localeCompare(b.category),
    );
  }

  /**
   * Avisa a todo el club quiénes fueron los campeones. Idempotente: salta a
   * quien ya tenga el aviso de esta temporada, así se puede reejecutar sin
   * llenarle la campana a nadie.
   */
  async notifyPodium(slug: string) {
    const season = await this.prisma.season.findUnique({ where: { slug } });
    if (!season) throw new NotFoundException(`Temporada "${slug}" no existe`);

    const rows = await this.podium(season.id);
    if (rows.length === 0) return { sent: 0, skipped: 0, podium: [] };

    const resumen = rows
      .map((r) => `${r.category}: ${r.champion ?? '—'}`)
      .join(' · ');

    const standings = await this.prisma.seasonStanding.findMany({
      where: { season_id: season.id },
      select: { player_id: true },
    });

    let sent = 0;
    let skipped = 0;
    for (const { player_id } of standings) {
      const already = await this.prisma.notification.findFirst({
        where: {
          player_id,
          type: 'season_winner',
          body: { contains: season.name },
        },
      });
      if (already) {
        skipped++;
        continue;
      }
      await this.notifications.create(player_id, {
        type: 'season_winner',
        title: '🏆 Campeones del semestre',
        body:
          `Se cerró ${season.name}. ¡Felicitaciones a los campeones y finalistas ` +
          `de cada categoría! Campeones — ${resumen}.`,
        action_label: 'Ver resumen',
        action_path: '/perfil',
      });
      sent++;
    }
    return { sent, skipped, podium: rows };
  }

  // ─────────────────── Resumen de cierre (modal del jugador) ───────────────────

  /**
   * Resumen de la última temporada cerrada para el jugador logueado.
   * `pending: false` cuando no hay nada que mostrar o cuando ya lo vio.
   */
  async summaryForUser(userId: string) {
    const player = await this.prisma.player.findUnique({
      where: { user_id: userId },
      select: { id: true, name: true, position: true, last_summary_seen: true },
    });
    if (!player) return { pending: false as const };

    const season = await this.prisma.season.findFirst({
      where: { status: 'closed' },
      orderBy: { closed_at: 'desc' },
    });
    if (!season) return { pending: false as const };
    if (player.last_summary_seen === season.slug)
      return { pending: false as const };

    const standing = await this.prisma.seasonStanding.findUnique({
      where: {
        season_id_player_id: { season_id: season.id, player_id: player.id },
      },
    });
    if (!standing) return { pending: false as const };

    const unlocked = await this.prisma.playerAchievement.findMany({
      where: { player_id: player.id, season_slug: season.slug },
      orderBy: { unlocked_at: 'asc' },
    });

    const nextSeason = await this.prisma.season.findFirst({
      where: { status: 'active' },
      orderBy: { started_at: 'desc' },
    });

    return {
      pending: true as const,
      season: { slug: season.slug, name: season.name },
      // El podio va para todos: los campeones lo ven después de su trofeo, y
      // el resto se entera de quién ganó.
      podium: await this.podium(season.id),
      next_season: nextSeason
        ? { slug: nextSeason.slug, name: nextSeason.name }
        : null,
      player_name: player.name,
      start_position: standing.start_position,
      final_position: standing.final_position,
      category: standing.category,
      wins: standing.wins,
      losses: standing.losses,
      total_matches: standing.total_matches,
      master_result: standing.master_result,
      /** Puestos ganados en el semestre (negativo = bajó). */
      climbed:
        standing.start_position != null && standing.final_position != null
          ? standing.start_position - standing.final_position
          : null,
      new_position: player.position,
      in_new_season: player.position != null,
      achievements: unlocked.map((u) => {
        const def = ACHIEVEMENTS_BY_CODE.get(u.code);
        return {
          code: u.code,
          name: def?.name ?? u.code,
          emoji: def?.emoji ?? '🏅',
          description: def?.description ?? '',
          context: u.context,
        };
      }),
    };
  }

  /** Apaga el modal para siempre (server-side: sobrevive al cambio de dispositivo). */
  async markSummarySeen(userId: string, slug: string) {
    const player = await this.prisma.player.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!player) throw new NotFoundException('Jugador no encontrado');
    await this.prisma.player.update({
      where: { id: player.id },
      data: { last_summary_seen: slug },
    });
    return { ok: true };
  }

  /** Histórico público de una temporada cerrada (ranking final). */
  async standings(slug: string) {
    const season = await this.prisma.season.findUnique({ where: { slug } });
    if (!season) throw new NotFoundException(`Temporada "${slug}" no existe`);

    const standings = await this.prisma.seasonStanding.findMany({
      where: { season_id: season.id, final_position: { not: null } },
      orderBy: { final_position: 'asc' },
      include: {
        player: { select: { id: true, name: true, avatar_url: true } },
      },
    });

    return { season, standings };
  }
}
