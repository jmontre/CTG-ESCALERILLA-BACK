/**
 * Corrige las fechas del cuadro Master del 1er semestre 2026.
 *
 *   npx ts-node scripts/fix-master-dates.ts            # simula
 *   npx ts-node scripts/fix-master-dates.ts --apply    # aplica
 *
 * Los partidos se cargaron a mano semanas después de jugarse, y
 * `processMasterResult` sella `played_at: new Date()` — o sea, quedaron todos
 * con la fecha en que se corrió el script, no con la que se jugaron. Lo mismo
 * los logros de temporada, que se otorgaron al cerrar.
 *
 * Idempotente: reejecutarlo deja las mismas fechas.
 */
import { PrismaClient } from '@prisma/client';
import { parseArgs, banner, done } from './lib/cli';

const MASTER_SEASON_NAME = '1er Semestre 2026';

/**
 * Las finales se jugaron el 22 de agosto (confirmado por el club).
 * 15:00 en Chile; en agosto el país está en UTC-4, sin horario de verano.
 */
const FINALS_PLAYED_AT = new Date('2026-08-22T19:00:00.000Z');

/**
 * Fechas de las semifinales. `null` = no confirmada todavía: el script las
 * salta y las deja como están, en vez de inventar una.
 *
 * La planilla del club traía estas fechas en la columna "Día y Hora", pero eran
 * las AGENDADAS: cuatro de los ocho partidos todavía no se habían jugado cuando
 * se hizo esa planilla, así que pueden no coincidir con la fecha real.
 */
const SEMIFINAL_DATES: Array<{
  category: string;
  players: [string, string];
  playedAt: Date | null;
}> = [
  {
    category: 'A',
    players: ['Ismael soto', 'Claudio Pinilla'],
    playedAt: null,
  },
  {
    category: 'A',
    players: ['Hernán Rojas', 'Claudio Pineda'],
    playedAt: null,
  },
  {
    category: 'B',
    players: ['Fernando Moreno', 'Randolfo Tapia'],
    playedAt: null,
  },
  {
    category: 'B',
    players: ['Benjamin Moreno', 'Robert Quezada'],
    playedAt: null,
  },
  {
    category: 'C',
    players: ['Cristian Ordoñez', 'Leandro Lobos'],
    playedAt: null,
  },
  {
    category: 'C',
    players: ['Diego Suárez', 'Daniel Soto Jr'],
    playedAt: null,
  },
  {
    category: 'D',
    players: ['Joaquín Quezada', 'Marianno Stipo'],
    playedAt: null,
  },
  {
    category: 'D',
    players: ['Gustavo Díaz', 'Maximiliano Gonzalez'],
    playedAt: null,
  },
];

/**
 * Logros que se corrigen a la fecha de las finales. `semifinalista` va también
 * el 22: es la fecha en que el cuadro quedó cerrado y se definieron los podios.
 */
const SEASON_ACHIEVEMENTS = ['campeon', 'finalista', 'semifinalista'];
const SEASON_SLUG = '2026-1';

const prisma = new PrismaClient();
const fmt = (d: Date | null) =>
  d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  banner('Corregir fechas del cuadro Master', apply);

  // ── Finales ──
  const finals = await prisma.masterMatch.findMany({
    where: { season: { name: MASTER_SEASON_NAME }, round: 'final' },
    include: {
      season: { select: { category: true } },
      player1: true,
      player2: true,
    },
  });

  console.log('FINALES → 22 de agosto:');
  for (const f of finals) {
    console.log(
      `  [${f.season.category}] ${f.player1.name} vs ${f.player2.name}` +
        `   ${fmt(f.played_at)} → ${fmt(FINALS_PLAYED_AT)}`,
    );
  }

  // ── Semifinales ──
  const pending = SEMIFINAL_DATES.filter((s) => s.playedAt === null);
  console.log('');
  if (pending.length > 0) {
    console.log(
      `SEMIFINALES: ${pending.length} sin fecha confirmada, se dejan como están.`,
    );
  }

  // ── Logros ──
  const achievements = await prisma.playerAchievement.count({
    where: { season_slug: SEASON_SLUG, code: { in: SEASON_ACHIEVEMENTS } },
  });
  console.log('');
  console.log(`LOGROS DE TEMPORADA → 22 de agosto: ${achievements} registros`);
  console.log(`  (${SEASON_ACHIEVEMENTS.join(', ')})`);

  if (!apply) return;

  const updatedFinals = await prisma.masterMatch.updateMany({
    where: { season: { name: MASTER_SEASON_NAME }, round: 'final' },
    data: { played_at: FINALS_PLAYED_AT },
  });

  let updatedSemis = 0;
  for (const row of SEMIFINAL_DATES) {
    if (!row.playedAt) continue;
    const season = await prisma.masterSeason.findFirst({
      where: { name: MASTER_SEASON_NAME, category: row.category },
    });
    if (!season) continue;
    const r = await prisma.masterMatch.updateMany({
      where: { season_id: season.id, round: 'semifinal' },
      data: { played_at: row.playedAt },
    });
    updatedSemis += r.count;
  }

  const updatedAchievements = await prisma.playerAchievement.updateMany({
    where: { season_slug: SEASON_SLUG, code: { in: SEASON_ACHIEVEMENTS } },
    data: { unlocked_at: FINALS_PLAYED_AT },
  });

  console.log('');
  console.log(`Finales actualizadas: ${updatedFinals.count}`);
  console.log(`Semifinales actualizadas: ${updatedSemis}`);
  console.log(`Logros actualizados: ${updatedAchievements.count}`);
}

main()
  .then(() => done(process.argv.includes('--apply')))
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
