/**
 * Compacta las posiciones de la escalerilla a 1..N, sin huecos ni duplicados.
 *
 * En producción quedaron dos jugadores compartiendo el #35 y el #33 vacío. Las
 * posiciones son enteros únicos por convención (no hay unique constraint, ver
 * CLAUDE.md), así que un duplicado no explota pero rompe el corrimiento.
 *
 * Ejecutar ANTES de cerrar la temporada, para que el ranking final del
 * histórico quede correcto.
 *
 *   npx ts-node scripts/fix-ladder-positions.ts            # simula
 *   npx ts-node scripts/fix-ladder-positions.ts --apply    # aplica
 *
 * Criterio de desempate entre dos jugadores en la misma posición: más
 * victorias primero; si empatan, el que lleva más partidos; si siguen
 * empatados, orden alfabético. Determinista en cualquier caso.
 */
import { PrismaClient } from '@prisma/client';
import { parseArgs, banner, done } from './lib/cli';

const prisma = new PrismaClient();

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  banner('Compactar posiciones de la escalerilla', apply);

  const players = await prisma.player.findMany({
    where: { position: { gte: 1, lt: 1000 } },
    select: {
      id: true,
      name: true,
      position: true,
      wins: true,
      total_matches: true,
    },
  });

  players.sort((a, b) => {
    if (a.position !== b.position) return a.position! - b.position!;
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.total_matches !== b.total_matches)
      return b.total_matches - a.total_matches;
    return a.name.localeCompare(b.name);
  });

  const seen = new Map<number, string[]>();
  for (const p of players) {
    const list = seen.get(p.position!) ?? [];
    list.push(p.name);
    seen.set(p.position!, list);
  }
  const duplicates = [...seen.entries()].filter(
    ([, names]) => names.length > 1,
  );
  const gaps: number[] = [];
  for (let i = 1; i <= players.length; i++) if (!seen.has(i)) gaps.push(i);

  console.log(`Jugadores en la escalerilla: ${players.length}`);
  console.log(
    duplicates.length
      ? `Posiciones duplicadas: ${duplicates.map(([p, n]) => `#${p} (${n.join(' / ')})`).join(', ')}`
      : 'Posiciones duplicadas: ninguna',
  );
  console.log(
    gaps.length
      ? `Huecos: ${gaps.map((g) => `#${g}`).join(', ')}`
      : 'Huecos: ninguno',
  );
  console.log('');

  const changes = players
    .map((p, i) => ({ player: p, from: p.position!, to: i + 1 }))
    .filter((c) => c.from !== c.to);

  if (changes.length === 0) {
    console.log('✅ La escalerilla ya está compacta. Nada que hacer.');
    return;
  }

  for (const c of changes) {
    console.log(
      `  #${String(c.from).padStart(2)} → #${String(c.to).padStart(2)}  ${c.player.name}`,
    );
  }

  if (!apply) return;

  // Pivot a un rango libre (9000+) y después a destino: dos pasadas evitan
  // colisiones intermedias sin depender de un unique constraint.
  await prisma.$transaction([
    ...changes.map((c, i) =>
      prisma.player.update({
        where: { id: c.player.id },
        data: { position: 9000 + i },
      }),
    ),
    ...changes.map((c) =>
      prisma.player.update({
        where: { id: c.player.id },
        data: { position: c.to },
      }),
    ),
    ...changes.map((c) =>
      prisma.rankingHistory.create({
        data: {
          player_id: c.player.id,
          old_position: c.from,
          position: c.to,
          reason: 'admin_fix_positions',
        },
      }),
    ),
  ]);
}

main()
  .then(() => done(process.argv.includes('--apply')))
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
