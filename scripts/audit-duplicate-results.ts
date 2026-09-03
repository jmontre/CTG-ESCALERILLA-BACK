/**
 * Audita los daños de un resultado procesado más de una vez.
 *
 * Hasta el fix del claim atómico en `processDoubleConfirmation`, varias
 * requests concurrentes a POST /challenges/:id/result pasaban todas la
 * validación `status === 'accepted'` (el status recién cambia al final, varios
 * segundos después) y corrían el corrimiento, las stats y las notificaciones
 * una vez cada una.
 *
 * Huella en la base: dos o más filas IDÉNTICAS en ranking_history —mismo
 * jugador, mismo old_position → position, mismo motivo— separadas por
 * segundos. Un corrimiento legítimo posterior nunca repite el old_position
 * (arranca donde terminó el anterior), así que el falso positivo no existe.
 *
 * El script NO mueve posiciones: cuánto quedó corrido el ranking depende de
 * cómo se entrelazaron las transacciones, y reconstruirlo a ciegas es peor que
 * el problema. Reporta los incidentes para revisarlos y, con --fix-stats,
 * recalcula wins/losses/total_matches (que sí son deterministas: salen de
 * contar los desafíos completados de la temporada vigente; el Master lleva las
 * suyas aparte en master_group_players).
 *
 *   npx ts-node scripts/audit-duplicate-results.ts               # reporte
 *   npx ts-node scripts/audit-duplicate-results.ts --days=365    # ventana
 *   npx ts-node scripts/audit-duplicate-results.ts --apply --fix-stats
 *
 * Para huecos o posiciones repetidas: scripts/fix-ladder-positions.ts
 */
import { PrismaClient } from '@prisma/client';
import { parseArgs, banner, done } from './lib/cli';

const prisma = new PrismaClient();

/** Dos filas idénticas dentro de esto = el mismo evento procesado dos veces. */
const WINDOW_SECONDS = 30;

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const daysArg = process.argv.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number(daysArg.split('=')[1]) : 30;
  const fixStats = process.argv.includes('--fix-stats');
  banner(`Resultados procesados más de una vez (últimos ${days} días)`, apply);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const history = await prisma.rankingHistory.findMany({
    where: { created_at: { gte: since } },
    orderBy: { created_at: 'asc' },
    include: { player: { select: { name: true, position: true } } },
  });

  // Filas idénticas (jugador + tramo + motivo) dentro de la misma ventana.
  const seen = new Map<string, (typeof history)[number][]>();
  for (const row of history) {
    const key = `${row.player_id}|${row.old_position}|${row.position}|${row.reason}`;
    const list = seen.get(key) ?? [];
    if (
      list.length &&
      row.created_at.getTime() - list[list.length - 1].created_at.getTime() >
        WINDOW_SECONDS * 1000
    ) {
      seen.set(key, [row]); // evento nuevo, no duplicado
      continue;
    }
    list.push(row);
    seen.set(key, list);
  }

  // Agrupar los duplicados por incidente (mismo minuto) para leerlos juntos.
  const incidents = new Map<string, { veces: number; detalle: string[] }>();
  for (const rows of seen.values()) {
    if (rows.length < 2) continue;
    const stamp = rows[0].created_at.toISOString().slice(0, 16);
    const inc = incidents.get(stamp) ?? { veces: 0, detalle: [] };
    inc.veces = Math.max(inc.veces, rows.length);
    inc.detalle.push(
      `${rows[0].player.name}: ${rows[0].old_position}→${rows[0].position} (${rows[0].reason}) ×${rows.length} — hoy está en #${rows[0].player.position}`,
    );
    incidents.set(stamp, inc);
  }

  if (incidents.size === 0) {
    console.log('✅ Sin corrimientos duplicados en el período.');
  } else {
    for (const [stamp, inc] of [...incidents].sort()) {
      console.log(
        `⚠️  ${stamp.replace('T', ' ')} UTC — resultado procesado ${inc.veces} veces:`,
      );
      for (const d of inc.detalle) console.log(`     • ${d}`);
      console.log('');
    }
    console.log(
      'ℹ️  Las posiciones no se tocan acá: revisa el orden de los jugadores del ' +
        'tramo y corrígelo con POST /admin/players/:id/move si quedó corrido.',
    );
  }

  // ── Stats vs. desafíos de la temporada vigente ────────────────────────────
  const season = await prisma.season.findFirst({
    orderBy: { started_at: 'desc' },
    select: { name: true, started_at: true },
  });
  console.log('');
  console.log(
    `━━━ Stats vs. desafíos completados (${season ? season.name : 'todo el historial'}) ━━━`,
  );
  const players = await prisma.player.findMany({
    select: {
      id: true,
      name: true,
      wins: true,
      losses: true,
      total_matches: true,
    },
  });
  const completed = await prisma.challenge.findMany({
    where: {
      status: 'completed',
      winner_id: { not: null },
      ...(season ? { resolved_at: { gte: season.started_at } } : {}),
    },
    select: { challenger_id: true, challenged_id: true, winner_id: true },
  });

  const statFixes: {
    id: string;
    name: string;
    wins: number;
    losses: number;
    total: number;
  }[] = [];
  for (const p of players) {
    const wins = completed.filter((c) => c.winner_id === p.id).length;
    const losses = completed.filter(
      (c) =>
        c.winner_id !== p.id &&
        (c.challenger_id === p.id || c.challenged_id === p.id),
    ).length;
    const total = wins + losses;
    if (p.wins !== wins || p.losses !== losses || p.total_matches !== total) {
      console.log(
        `⚠️  ${p.name}: ficha ${p.wins}G/${p.losses}P/${p.total_matches}J — desafíos ${wins}G/${losses}P/${total}J`,
      );
      statFixes.push({ id: p.id, name: p.name, wins, losses, total });
    }
  }
  if (statFixes.length === 0) console.log('✅ Stats consistentes.');

  if (apply && fixStats) {
    console.log('');
    for (const fix of statFixes) {
      await prisma.player.update({
        where: { id: fix.id },
        data: { wins: fix.wins, losses: fix.losses, total_matches: fix.total },
      });
      console.log(
        `✏️  ${fix.name}: stats → ${fix.wins}G/${fix.losses}P/${fix.total}J`,
      );
    }
  } else if (statFixes.length) {
    console.log('');
    console.log(
      'ℹ️  Stats no modificadas. Corren solo con --apply --fix-stats, y ojo: ' +
        'asumen que wins/losses son de la temporada vigente.',
    );
  }

  done(apply);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
