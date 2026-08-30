import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  console.log('📊 Extrayendo SOLO usernames y posiciones...\n');

  const players = await prisma.player.findMany({
    include: {
      user: true,
    },
    orderBy: {
      position: 'asc',
    },
    where: {
      user: {
        username: { not: 'admin' }, // Excluir admin
      },
    },
  });

  console.log(
    '┌──────┬─────────────────────────────┬─────────────────────────┐',
  );
  console.log(
    '│ Pos  │ Nombre                      │ Username                │',
  );
  console.log(
    '├──────┼─────────────────────────────┼─────────────────────────┤',
  );

  const mapping: { [key: string]: number } = {};

  for (const player of players) {
    mapping[player.user.username] = player.position;
    console.log(
      `│ ${player.position.toString().padStart(4, ' ')} │ ${player.name.padEnd(27)} │ ${player.user.username.padEnd(23)} │`,
    );
  }

  console.log(
    '└──────┴─────────────────────────────┴─────────────────────────┘',
  );

  // Generar script TypeScript listo para copiar/pegar
  const scriptContent = `import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updatePositionsOnly() {
  console.log('🔄 Actualizando SOLO posiciones (sin tocar nombres, emails, etc)...\\n');

  // Mapeo: username -> nueva posición
  const newPositions: { [key: string]: number } = {
${Object.entries(mapping)
  .sort((a, b) => a[1] - b[1])
  .map(([username, position]) => `    '${username}': ${position},`)
  .join('\n')}
  };

  console.log('PASO 1: Moviendo a posiciones temporales...\\n');
  
  const allPlayers = await prisma.player.findMany({
    include: { user: true },
    where: {
      user: { username: { not: 'admin' } }
    }
  });

  for (const player of allPlayers) {
    await prisma.player.update({
      where: { id: player.id },
      data: { position: 1000 + player.position },
    });
  }

  console.log('✅ Movidos a posiciones temporales\\n');
  console.log('PASO 2: Asignando nuevas posiciones...\\n');

  let updated = 0;

  for (const [username, newPosition] of Object.entries(newPositions)) {
    const player = await prisma.player.findFirst({
      where: { user: { username } },
      include: { user: true }
    });

    if (player) {
      await prisma.player.update({
        where: { id: player.id },
        data: { position: newPosition }, // SOLO actualiza position
      });
      console.log(\`✅ \${newPosition.toString().padStart(2, ' ')}. \${player.name}\`);
      updated++;
    }
  }

  console.log(\`\\n✅ \${updated} posiciones actualizadas\\n\`);
}

updatePositionsOnly()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
`;

  fs.writeFileSync('update-positions-only.ts', scriptContent);
  console.log('\n✅ Script generado: update-positions-only.ts');
  console.log('📋 Total de jugadores: ' + players.length);
  console.log('\n💡 Para usar: npx ts-node update-positions-only.ts');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
