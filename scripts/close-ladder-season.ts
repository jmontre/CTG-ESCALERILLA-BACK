/**
 * Cierra una temporada de la escalerilla: congela el ranking final y el récord
 * de cada jugador en `season_standings` y otorga los logros del cuadro Master
 * (campeón / finalista / semifinalista).
 *
 *   npx ts-node scripts/close-ladder-season.ts            # simula
 *   npx ts-node scripts/close-ladder-season.ts --apply    # aplica
 *
 * Correr DESPUÉS de fix-ladder-positions y load-master-results, y ANTES de
 * cargar el ranking nuevo: el cierre fotografía las posiciones que hay en ese
 * momento.
 *
 * Si la temporada no existe todavía (es el caso del 1er semestre 2026, que se
 * jugó antes de que existiera este módulo) la crea al vuelo con `started_at`
 * en SEASON_STARTED_AT, para que los logros por fecha calcen con el semestre.
 */
import { PrismaClient } from '@prisma/client';
import { SeasonsService } from '../src/seasons/seasons.service';
import { AchievementsService } from '../src/achievements/achievements.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { parseArgs, banner, done } from './lib/cli';

const SEASON_SLUG = '2026-1';
const SEASON_NAME = 'Escalerilla 2026 · 1er Semestre';
const SEASON_STARTED_AT = new Date('2026-01-01T00:00:00.000Z');
const MASTER_SEASON_NAME = '1er Semestre 2026';

const prisma = new PrismaClient();
const p = prisma as unknown as PrismaService;
const seasons = new SeasonsService(
  p,
  new AchievementsService(p, new NotificationsService(p)),
);

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  banner(`Cerrar temporada ${SEASON_SLUG}`, apply);

  const players = await prisma.player.findMany({
    where: { position: { gte: 1, lt: 1000 }, user: { is_admin: false } },
    orderBy: { position: 'asc' },
    select: {
      name: true,
      position: true,
      wins: true,
      losses: true,
      total_matches: true,
    },
  });
  console.log(`Jugadores a congelar en el histórico: ${players.length}`);
  console.log(
    `  del #${players[0]?.position} (${players[0]?.name}) al #${players.at(-1)?.position} (${players.at(-1)?.name})`,
  );

  const masterSeasons = await prisma.masterSeason.findMany({
    where: { name: MASTER_SEASON_NAME },
    orderBy: { category: 'asc' },
    include: {
      matches: {
        where: { round: { in: ['semifinal', 'final'] } },
        include: { player1: true, player2: true, winner: true },
      },
    },
  });

  console.log('');
  console.log('Podios que se van a registrar:');
  let missing = 0;
  for (const ms of masterSeasons) {
    const final = ms.matches.find((m) => m.round === 'final');
    if (final?.status === 'completed' && final.winner) {
      const loser =
        final.winner_id === final.player1_id ? final.player2 : final.player1;
      console.log(
        `  [${ms.category}] 🏆 ${final.winner.name}   🥈 ${loser.name}`,
      );
    } else {
      missing++;
      console.log(
        `  [${ms.category}] ⚠️  sin final completada — no habrá campeón registrado`,
      );
    }
  }
  if (missing > 0) {
    console.log('');
    console.log(
      `⚠️  ${missing} categoría(s) sin final. Corre primero load-master-results.ts --apply.`,
    );
  }

  if (!apply) return;

  // La temporada del 1er semestre no existía como registro: se crea con la
  // fecha real de inicio para que las consultas por rango calcen.
  const existing = await prisma.season.findUnique({
    where: { slug: SEASON_SLUG },
  });
  if (!existing) {
    await prisma.season.create({
      data: {
        slug: SEASON_SLUG,
        name: SEASON_NAME,
        status: 'active',
        started_at: SEASON_STARTED_AT,
      },
    });
    console.log(
      `\nTemporada "${SEASON_SLUG}" creada (inicio ${SEASON_STARTED_AT.toISOString().slice(0, 10)}).`,
    );
  }

  const result = await seasons.closeSeason(SEASON_SLUG, MASTER_SEASON_NAME);
  console.log('');
  console.log(`Standings congelados: ${result.standings}`);
  console.log(
    `Campeones: ${result.champions} · Finalistas: ${result.finalists} · Semifinalistas: ${result.semifinalists}`,
  );
}

main()
  .then(() => done(process.argv.includes('--apply')))
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
