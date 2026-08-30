/**
 * Carga los resultados del cuadro Master "1er Semestre 2026" (semifinales y
 * finales) que se jugaron fuera de la app.
 *
 *   npx ts-node scripts/load-master-results.ts            # simula
 *   npx ts-node scripts/load-master-results.ts --apply    # aplica
 *
 * Reutiliza `MasterService.submitResult`, o sea el MISMO camino que el admin
 * desde la app: al completar las dos semifinales el servicio genera la final
 * solo, y al completar la final deja la temporada en `completed`.
 *
 * Idempotente: los partidos ya completados se saltan, así que se puede
 * reejecutar sin duplicar nada.
 *
 * No se envía ningún WhatsApp: el servicio corta en `if (!this.ready)` y un
 * script nunca llama a `whatsappService.initialize()` (eso pasa solo en
 * main.ts). Menos mal, porque si no cargar 12 resultados de una despertaría al
 * grupo entero con avisos de partidos de hace dos semanas. La línea de abajo
 * es cinturón y tirantes por si el servicio cambiara a inicialización perezosa.
 * (Los "📱 WhatsApp enviado a ..." que igual aparecen en consola son un log de
 * MasterService que corre antes de saber si el envío prosperó.)
 */
process.env.WHATSAPP_ENABLED = 'false';

import { PrismaClient } from '@prisma/client';
import { MasterService } from '../src/master/master.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { parseArgs, banner, done, normalizeName } from './lib/cli';

const MASTER_SEASON_NAME = '1er Semestre 2026';

interface ResultRow {
  category: string;
  round: 'semifinal' | 'final';
  /** Los dos jugadores, en cualquier orden. */
  players: [string, string];
  winner: string;
  score: string;
}

const RESULTS: ResultRow[] = [
  // ── Semifinales ──
  {
    category: 'A',
    round: 'semifinal',
    players: ['Ismael soto', 'Claudio Pinilla'],
    winner: 'Ismael soto',
    score: '6-1, 6-3',
  },
  {
    category: 'A',
    round: 'semifinal',
    players: ['Hernán Rojas', 'Claudio Pineda'],
    winner: 'Hernán Rojas',
    score: '6-0, 7-5',
  },
  {
    category: 'B',
    round: 'semifinal',
    players: ['Fernando Moreno', 'Randolfo Tapia'],
    winner: 'Fernando Moreno',
    score: '6-2, 6-2',
  },
  {
    category: 'B',
    round: 'semifinal',
    players: ['Benjamin Moreno', 'Robert Quezada'],
    winner: 'Benjamin Moreno',
    score: '6-3, 6-1',
  },
  {
    category: 'C',
    round: 'semifinal',
    players: ['Cristian Ordoñez', 'Leandro Lobos'],
    winner: 'Cristian Ordoñez',
    score: '7-5, 1-6, [10-6]',
  },
  {
    category: 'C',
    round: 'semifinal',
    players: ['Diego Suárez', 'Daniel Soto Jr'],
    winner: 'Daniel Soto Jr',
    score: '6-0, 6-3',
  },
  {
    category: 'D',
    round: 'semifinal',
    players: ['Joaquín Quezada', 'Marianno Stipo'],
    winner: 'Marianno Stipo',
    score: '4-6, 6-1, [10-7]',
  },
  {
    category: 'D',
    round: 'semifinal',
    players: ['Gustavo Díaz', 'Maximiliano Gonzalez'],
    winner: 'Gustavo Díaz',
    score: '6-2, 6-4',
  },

  // ── Finales ──
  {
    category: 'A',
    round: 'final',
    players: ['Ismael soto', 'Hernán Rojas'],
    winner: 'Ismael soto',
    score: '4-6 (Retiro)',
  },
  {
    category: 'B',
    round: 'final',
    players: ['Benjamin Moreno', 'Fernando Moreno'],
    winner: 'Benjamin Moreno',
    score: '1-6, 6-4, 6-4',
  },
  {
    category: 'C',
    round: 'final',
    players: ['Cristian Ordoñez', 'Daniel Soto Jr'],
    winner: 'Cristian Ordoñez',
    score: '6-4, 7-5',
  },
  {
    category: 'D',
    round: 'final',
    players: ['Marianno Stipo', 'Gustavo Díaz'],
    winner: 'Marianno Stipo',
    score: 'W.O.',
  },
];

const prisma = new PrismaClient();
// MasterService solo depende de PrismaService: se instancia directo, sin
// levantar el contexto de Nest (que además engancharía los cron jobs).
const master = new MasterService(prisma as unknown as PrismaService);

/** ¿El nombre de la planilla y el de la base son la misma persona? */
function sameName(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na[0] === nb[0] && na.slice(1).some((w) => nb.includes(w));
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  banner(`Resultados Master — ${MASTER_SEASON_NAME}`, apply);

  for (const round of ['semifinal', 'final'] as const) {
    console.log(`── ${round === 'semifinal' ? 'SEMIFINALES' : 'FINALES'} ──`);

    for (const row of RESULTS.filter((r) => r.round === round)) {
      const season = await prisma.masterSeason.findFirst({
        where: { name: MASTER_SEASON_NAME, category: row.category },
      });
      if (!season) {
        console.log(
          `  ⚠️  [${row.category}] no existe la temporada Master "${MASTER_SEASON_NAME}"`,
        );
        continue;
      }

      const matches = await prisma.masterMatch.findMany({
        where: { season_id: season.id, round: row.round },
        include: { player1: true, player2: true },
      });

      const match = matches.find(
        (m) =>
          (sameName(m.player1.name, row.players[0]) &&
            sameName(m.player2.name, row.players[1])) ||
          (sameName(m.player1.name, row.players[1]) &&
            sameName(m.player2.name, row.players[0])),
      );

      if (!match) {
        console.log(
          `  ⚠️  [${row.category}] no encontré ${row.round}: ${row.players[0]} vs ${row.players[1]}` +
            (round === 'final' ? ' (¿faltan las semifinales?)' : ''),
        );
        continue;
      }
      if (match.status === 'completed') {
        console.log(
          `  ⏭️  [${row.category}] ya cargado: ${match.player1.name} vs ${match.player2.name} → ${row.winner}`,
        );
        continue;
      }

      const winner = sameName(match.player1.name, row.winner)
        ? match.player1
        : match.player2;
      if (!sameName(winner.name, row.winner)) {
        console.log(
          `  ❌ [${row.category}] el ganador "${row.winner}" no juega ese partido`,
        );
        continue;
      }

      console.log(
        `  ${apply ? '✅' : '·'} [${row.category}] ${match.player1.name} vs ${match.player2.name} → ` +
          `${winner.name} (${row.score})`,
      );
      if (apply) await master.submitResult(match.id, winner.id, row.score);
    }
    console.log('');
  }

  // Resumen final del cuadro
  const seasons = await prisma.masterSeason.findMany({
    where: { name: MASTER_SEASON_NAME },
    orderBy: { category: 'asc' },
    include: {
      matches: {
        where: { round: 'final' },
        include: { player1: true, player2: true, winner: true },
      },
    },
  });
  console.log('── ESTADO DEL CUADRO ──');
  for (const s of seasons) {
    const f = s.matches[0];
    const podium = f?.winner
      ? `campeón ${f.winner.name}, finalista ${f.winner_id === f.player1_id ? f.player2.name : f.player1.name}`
      : f
        ? `final pendiente: ${f.player1.name} vs ${f.player2.name}`
        : 'sin final generada';
    console.log(`  [${s.category}] ${s.status.padEnd(10)} ${podium}`);
  }
}

main()
  .then(() => done(process.argv.includes('--apply')))
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
