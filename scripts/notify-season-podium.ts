/**
 * Avisa a todo el club quiénes fueron los campeones y finalistas de una
 * temporada ya cerrada.
 *
 *   npx ts-node scripts/notify-season-podium.ts 2026-1            # simula
 *   npx ts-node scripts/notify-season-podium.ts 2026-1 --apply    # aplica
 *
 * Existe aparte de `close-ladder-season` porque el cierre del 1er semestre
 * 2026 se corrió antes de que el aviso existiera, y NO se puede reejecutar el
 * cierre para agregarlo: `closeSeason` congela las posiciones que hay en ese
 * momento, y hoy la escalerilla ya tiene el orden del 2do semestre — volvería
 * a escribir el histórico con los datos equivocados.
 *
 * Idempotente: salta a quien ya tenga el aviso de esa temporada.
 */
import { PrismaClient } from '@prisma/client';
import { SeasonsService } from '../src/seasons/seasons.service';
import { AchievementsService } from '../src/achievements/achievements.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { parseArgs, banner, done } from './lib/cli';

const prisma = new PrismaClient();
const p = prisma as unknown as PrismaService;
const notifications = new NotificationsService(p);
const seasons = new SeasonsService(
  p,
  new AchievementsService(p, notifications),
  notifications,
);

async function main() {
  const { apply, rest } = parseArgs(process.argv.slice(2));
  const slug = rest[0];
  if (!slug) {
    console.error(
      'Uso: npx ts-node scripts/notify-season-podium.ts <slug> [--apply]',
    );
    process.exit(1);
  }
  banner(`Aviso de campeones — temporada ${slug}`, apply);

  const season = await prisma.season.findUnique({ where: { slug } });
  if (!season) {
    console.error(`❌ No existe la temporada "${slug}".`);
    process.exit(1);
  }

  const podium = await seasons.podium(season.id);
  console.log(`Temporada: ${season.name}`);
  console.log('Podio:');
  for (const row of podium) {
    console.log(
      `  [${row.category}] 🏆 ${row.champion ?? '—'}   🥈 ${row.finalist ?? '—'}`,
    );
  }

  const total = await prisma.seasonStanding.count({
    where: { season_id: season.id },
  });
  const yaTienen = await prisma.notification.count({
    where: { type: 'season_winner', body: { contains: season.name } },
  });
  console.log('');
  console.log(`Jugadores en el histórico: ${total}`);
  console.log(
    `Ya tienen el aviso: ${yaTienen} · Lo recibirían: ${total - yaTienen}`,
  );

  if (!apply) return;

  const result = await seasons.notifyPodium(slug);
  console.log('');
  console.log(
    `Avisos enviados: ${result.sent} · Saltados (ya lo tenían): ${result.skipped}`,
  );
}

main()
  .then(() => done(process.argv.includes('--apply')))
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
