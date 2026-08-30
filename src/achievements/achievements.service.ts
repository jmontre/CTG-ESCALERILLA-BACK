import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toChileDateStr, chileWeekBoundsFromStr } from '../common/dates';
import {
  categoryOf as ladderCategoryOf,
  categoryRank,
  CategoryScheme,
} from '../common/ladder';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_CODE,
  AchievementDef,
} from './achievements.catalog';
import {
  parseScore,
  isDoubleBagel,
  isComeback,
  isSuperTiebreakWin,
} from './score';

/**
 * Categoría de una posición. Reexportado desde common/ladder.ts, que es la
 * definición única de los rangos (y sabe distinguir el esquema histórico de
 * 4 categorías del actual de 3).
 */
export function categoryOf(
  position: number | null | undefined,
  scheme?: CategoryScheme,
): string | null {
  return ladderCategoryOf(position, scheme);
}

interface MatchRow {
  id: string;
  challenger_id: string;
  challenged_id: string;
  winner_id: string | null;
  played_at: Date | null;
}

@Injectable()
export class AchievementsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ───────────────────────────── Otorgar ─────────────────────────────

  /**
   * Otorga un logro. Idempotente: el @@unique(player, code, season_slug) hace
   * que otorgarlo dos veces sea no-op (P2002 capturado).
   * Nunca lanza — un fallo acá no debe romper la carga de un resultado.
   *
   * @param silent no crear notificación (para los otorgamientos retroactivos).
   * @returns true si el logro se desbloqueó recién.
   */
  async grant(
    playerId: string,
    code: string,
    opts: {
      seasonSlug?: string;
      context?: Prisma.InputJsonValue;
      silent?: boolean;
    } = {},
  ): Promise<boolean> {
    const def = ACHIEVEMENTS_BY_CODE.get(code);
    if (!def) {
      console.error(`⚠️ [achievements] Código desconocido: ${code}`);
      return false;
    }
    const seasonSlug = def.scope === 'global' ? 'global' : opts.seasonSlug;
    if (!seasonSlug) return false; // logro de temporada sin temporada activa

    try {
      await this.prisma.playerAchievement.create({
        data: {
          player_id: playerId,
          code,
          season_slug: seasonSlug,
          context: opts.context,
          seen: opts.silent ?? false,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return false; // ya lo tenía
      }
      console.error(`⚠️ [achievements] Error otorgando ${code}:`, e);
      return false;
    }

    if (!opts.silent) {
      await this.notifications.create(playerId, {
        type: 'achievement_unlocked',
        title: `${def.emoji} ¡Logro desbloqueado!`,
        body: `${def.name} — ${def.description}`,
        action_label: 'Ver mis logros',
        action_path: '/perfil',
      });
    }
    return true;
  }

  // ──────────────────────────── Evaluación ───────────────────────────

  /**
   * Evalúa los logros de ambos jugadores tras confirmarse el resultado de un
   * desafío. Se llama DESPUÉS de que el desafío quedó en `completed` y de que
   * las posiciones ya se movieron, porque varios logros leen el estado final.
   *
   * Nunca lanza: se invoca desde los flujos de resultado y del cron.
   */
  async evaluateAfterChallenge(params: {
    winnerId: string;
    loserId: string;
    score: string | null;
    /** Posiciones ANTES del corrimiento — para el logro Batacazo. */
    oldWinnerPosition: number | null;
    oldLoserPosition: number | null;
  }): Promise<void> {
    try {
      const season = await this.activeSeason();
      if (!season) return;

      await this.evaluateForPlayer(params.winnerId, season, {
        won: true,
        score: params.score,
        oldWinnerPosition: params.oldWinnerPosition,
        oldLoserPosition: params.oldLoserPosition,
      });
      await this.evaluateForPlayer(params.loserId, season, { won: false });
    } catch (e) {
      console.error('⚠️ [achievements] Error evaluando desafío:', e);
    }
  }

  /** Logros que dependen de reservas (anfitrión, madrugador, nocturno). */
  async evaluateAfterReservation(playerId: string): Promise<void> {
    try {
      const season = await this.activeSeason();
      if (!season) return;

      const reservations = await this.prisma.reservation.findMany({
        where: {
          player_id: playerId,
          status: { in: ['active', 'completed'] },
          created_at: { gte: season.started_at },
        },
        select: { time_slot: true, has_guest: true, guest_name: true },
      });

      const guests = new Set(
        reservations
          .filter((r) => r.has_guest && r.guest_name)
          .map((r) => r.guest_name.trim().toLowerCase()),
      );
      if (guests.size >= 3) {
        await this.grant(playerId, 'anfitrion', {
          seasonSlug: season.slug,
          context: { visitas: guests.size },
        });
      }
      if (reservations.some((r) => r.time_slot === '06:00')) {
        await this.grant(playerId, 'madrugador', { seasonSlug: season.slug });
      }
      if (reservations.some((r) => r.time_slot === '21:45')) {
        await this.grant(playerId, 'nocturno', { seasonSlug: season.slug });
      }
    } catch (e) {
      console.error('⚠️ [achievements] Error evaluando reserva:', e);
    }
  }

  /**
   * Núcleo de la evaluación por jugador. Hace UNA consulta de sus partidos del
   * semestre y deriva todos los logros de ahí.
   */
  private async evaluateForPlayer(
    playerId: string,
    season: { id: string; slug: string; started_at: Date },
    ctx: {
      won: boolean;
      score?: string | null;
      oldWinnerPosition?: number | null;
      oldLoserPosition?: number | null;
    },
  ): Promise<void> {
    const matches = await this.playerMatches(playerId, season.started_at);
    const slug = season.slug;

    // ── Volumen ──
    if (matches.length >= 1)
      await this.grant(playerId, 'debut', { seasonSlug: slug });
    if (matches.length >= 10) {
      await this.grant(playerId, 'guerrero', {
        seasonSlug: slug,
        context: { partidos: matches.length },
      });
    }

    // ── Constancia ──
    await this.evaluateConsistency(playerId, slug, matches);

    // ── Rivales distintos (global) ──
    const allMatches = await this.playerMatches(playerId, null);
    const rivals = new Set(
      allMatches.map((m) =>
        m.challenger_id === playerId ? m.challenged_id : m.challenger_id,
      ),
    );
    if (rivals.size >= 10) {
      await this.grant(playerId, 'sociable', {
        context: { rivales: rivals.size },
      });
    }

    // ── Antigüedad (global) ──
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { position: true, created_at: true },
    });
    if (player) {
      const oneYearMs = 365 * 24 * 60 * 60 * 1000;
      if (Date.now() - player.created_at.getTime() >= oneYearMs) {
        await this.grant(playerId, 'aniversario');
      }
    }

    if (!ctx.won) return;

    // ── Racha de victorias (partidos consecutivos ganados, los más recientes) ──
    let streak = 0;
    for (let i = matches.length - 1; i >= 0; i--) {
      if (matches[i].winner_id === playerId) streak++;
      else break;
    }
    if (streak >= 3)
      await this.grant(playerId, 'racha_3', {
        seasonSlug: slug,
        context: { racha: streak },
      });
    if (streak >= 5)
      await this.grant(playerId, 'racha_5', {
        seasonSlug: slug,
        context: { racha: streak },
      });
    if (streak >= 10)
      await this.grant(playerId, 'racha_10', {
        seasonSlug: slug,
        context: { racha: streak },
      });

    // ── Muralla: 3 defensas seguidas (desafíos recibidos y ganados) ──
    const defenses = matches.filter((m) => m.challenged_id === playerId);
    let defenseStreak = 0;
    for (let i = defenses.length - 1; i >= 0; i--) {
      if (defenses[i].winner_id === playerId) defenseStreak++;
      else break;
    }
    if (defenseStreak >= 3) {
      await this.grant(playerId, 'muralla', {
        seasonSlug: slug,
        context: { defensas: defenseStreak },
      });
    }

    // ── Detalle del marcador ──
    const parsed = parseScore(ctx.score);
    if (isDoubleBagel(parsed))
      await this.grant(playerId, 'rosquilla', {
        seasonSlug: slug,
        context: { score: ctx.score },
      });
    if (isComeback(parsed))
      await this.grant(playerId, 'remontada', {
        seasonSlug: slug,
        context: { score: ctx.score },
      });
    if (isSuperTiebreakWin(parsed))
      await this.grant(playerId, 'maratonista', {
        seasonSlug: slug,
        context: { score: ctx.score },
      });

    // ── Batacazo: el rival estaba 5+ puestos más arriba ──
    const { oldWinnerPosition: wPos, oldLoserPosition: lPos } = ctx;
    if (wPos != null && lPos != null && wPos - lPos >= 5) {
      await this.grant(playerId, 'batacazo', {
        seasonSlug: slug,
        context: { desde: wPos, contra: lPos },
      });
    }

    // ── Posición actual: cima, ascenso, escalador ──
    if (player?.position)
      await this.evaluatePosition(playerId, season, player.position);
  }

  /** Cima (#1), ascenso de categoría y escalador/alpinista (+10 / +20 puestos). */
  private async evaluatePosition(
    playerId: string,
    season: { id: string; slug: string },
    position: number,
  ): Promise<void> {
    if (position === 1) {
      await this.grant(playerId, 'cima', { seasonSlug: season.slug });
    }

    const standing = await this.prisma.seasonStanding.findUnique({
      where: {
        season_id_player_id: { season_id: season.id, player_id: playerId },
      },
      select: { start_position: true },
    });
    const start = standing?.start_position;
    if (!start) return;

    const climbed = start - position;
    if (climbed >= 10) {
      await this.grant(playerId, 'escalador', {
        seasonSlug: season.slug,
        context: { desde: start, hasta: position, puestos: climbed },
      });
    }
    if (climbed >= 20) {
      await this.grant(playerId, 'alpinista', {
        seasonSlug: season.slug,
        context: { desde: start, hasta: position, puestos: climbed },
      });
    }

    const startCat = categoryOf(start);
    const nowCat = categoryOf(position);
    if (startCat && nowCat && categoryRank(nowCat) < categoryRank(startCat)) {
      await this.grant(playerId, 'ascenso', {
        seasonSlug: season.slug,
        context: { desde: startCat, hasta: nowCat },
      });
    }
  }

  /**
   * Semana perfecta (3 semanas seguidas con partido), mes redondo (4 semanas
   * distintas dentro de un mismo mes) y relojito (un partido en cada mes del
   * semestre). Todo en semanas lunes-domingo hora Chile.
   */
  private async evaluateConsistency(
    playerId: string,
    slug: string,
    matches: MatchRow[],
  ): Promise<void> {
    const weekStarts = new Set<string>();
    const months = new Set<string>();
    for (const m of matches) {
      if (!m.played_at) continue;
      const dateStr = toChileDateStr(m.played_at);
      weekStarts.add(
        chileWeekBoundsFromStr(dateStr).weekStart.toISOString().slice(0, 10),
      );
      months.add(dateStr.slice(0, 7));
    }

    // 3 semanas consecutivas: cada lunes + 7 días debe existir en el set.
    const weeks = [...weekStarts].sort();
    let run = 1;
    let best = weeks.length > 0 ? 1 : 0;
    for (let i = 1; i < weeks.length; i++) {
      const prev = new Date(weeks[i - 1] + 'T00:00:00Z').getTime();
      const cur = new Date(weeks[i] + 'T00:00:00Z').getTime();
      run = cur - prev === 7 * 24 * 60 * 60 * 1000 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    if (best >= 3) {
      await this.grant(playerId, 'semana_perfecta', {
        seasonSlug: slug,
        context: { semanas: best },
      });
    }

    // Mes redondo: 4 lunes distintos dentro del mismo mes calendario.
    const weeksPerMonth = new Map<string, number>();
    for (const w of weeks) {
      const key = w.slice(0, 7);
      weeksPerMonth.set(key, (weeksPerMonth.get(key) ?? 0) + 1);
    }
    if ([...weeksPerMonth.values()].some((n) => n >= 4)) {
      await this.grant(playerId, 'mes_redondo', { seasonSlug: slug });
    }

    // Relojito: al menos un partido en cada mes transcurrido del semestre.
    if (months.size >= 6) {
      await this.grant(playerId, 'relojito', {
        seasonSlug: slug,
        context: { meses: months.size },
      });
    }
  }

  // ───────────────────────────── Consultas ────────────────────────────

  /** Desafíos completados del jugador, cronológicos. `since=null` → históricos. */
  private async playerMatches(
    playerId: string,
    since: Date | null,
  ): Promise<MatchRow[]> {
    return this.prisma.challenge.findMany({
      where: {
        status: 'completed',
        winner_id: { not: null },
        ...(since ? { played_at: { gte: since } } : {}),
        OR: [{ challenger_id: playerId }, { challenged_id: playerId }],
      },
      orderBy: { played_at: 'asc' },
      select: {
        id: true,
        challenger_id: true,
        challenged_id: true,
        winner_id: true,
        played_at: true,
      },
    });
  }

  async activeSeason() {
    return this.prisma.season.findFirst({
      where: { status: 'active' },
      orderBy: { started_at: 'desc' },
    });
  }

  /** Catálogo completo + estado de desbloqueo, para la grilla del perfil. */
  async findForPlayer(playerId: string) {
    const unlocked = await this.prisma.playerAchievement.findMany({
      where: { player_id: playerId },
      orderBy: { unlocked_at: 'desc' },
    });
    const byCode = new Map<string, (typeof unlocked)[number]>();
    for (const u of unlocked) {
      if (!byCode.has(u.code)) byCode.set(u.code, u); // el más reciente
    }

    return {
      total: ACHIEVEMENTS.length,
      unlocked_count: byCode.size,
      achievements: ACHIEVEMENTS.map((def: AchievementDef) => {
        const got = byCode.get(def.code);
        return {
          ...def,
          unlocked: !!got,
          unlocked_at: got?.unlocked_at ?? null,
          season_slug: got?.season_slug ?? null,
          context: got?.context ?? null,
          /** Cuántas veces lo consiguió (una por temporada). */
          times: unlocked.filter((u) => u.code === def.code).length,
        };
      }),
    };
  }

  /** Solo los desbloqueados, para mostrar insignias en el perfil público. */
  async findUnlockedForPlayer(playerId: string) {
    const unlocked = await this.prisma.playerAchievement.findMany({
      where: { player_id: playerId },
      orderBy: { unlocked_at: 'desc' },
    });
    const seen = new Set<string>();
    return unlocked
      .filter((u) => (seen.has(u.code) ? false : (seen.add(u.code), true)))
      .map((u) => {
        const def = ACHIEVEMENTS_BY_CODE.get(u.code);
        return {
          code: u.code,
          name: def?.name ?? u.code,
          emoji: def?.emoji ?? '🏅',
          description: def?.description ?? '',
          group: def?.group ?? 'club',
          unlocked_at: u.unlocked_at,
          season_slug: u.season_slug,
          context: u.context,
        };
      });
  }

  /** Logros desbloqueados que el jugador todavía no vio (modal de celebración). */
  async findPending(playerId: string) {
    const pending = await this.prisma.playerAchievement.findMany({
      where: { player_id: playerId, seen: false },
      orderBy: { unlocked_at: 'asc' },
    });
    return pending.map((p) => {
      const def = ACHIEVEMENTS_BY_CODE.get(p.code);
      return {
        id: p.id,
        code: p.code,
        name: def?.name ?? p.code,
        emoji: def?.emoji ?? '🏅',
        description: def?.description ?? '',
        group: def?.group ?? 'club',
        season_slug: p.season_slug,
        context: p.context,
        unlocked_at: p.unlocked_at,
      };
    });
  }

  async markSeen(playerId: string, ids: string[]) {
    await this.prisma.playerAchievement.updateMany({
      where: { player_id: playerId, id: { in: ids } },
      data: { seen: true },
    });
    return { marked: ids.length };
  }
}
