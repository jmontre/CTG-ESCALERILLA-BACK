import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  console.log('📊 Exportando posiciones actuales de jugadores...\n');

  const players = await prisma.player.findMany({
    include: {
      user: true,
    },
    orderBy: {
      position: 'asc',
    },
  });

  console.log(
    '┌────┬─────────────────────────────────┬─────────────────────────┬──────────────┬──────────┐',
  );
  console.log(
    '│ #  │ Nombre                          │ Username                │ Email        │ Teléfono │',
  );
  console.log(
    '├────┼─────────────────────────────────┼─────────────────────────┼──────────────┼──────────┤',
  );

  const data: any[] = [];

  for (const player of players) {
    const row = {
      position: player.position,
      name: player.name,
      username: player.user.username,
      email: player.user.email,
      phone: player.phone || 'N/A',
      immune_until: player.immune_until,
      vulnerable_until: player.vulnerable_until,
    };

    data.push(row);

    console.log(
      `│ ${player.position.toString().padStart(2, ' ')} │ ${player.name.padEnd(31)} │ ${player.user.username.padEnd(23)} │ ${(player.user.email.substring(0, 12) + '...').padEnd(12)} │ ${(player.phone || 'N/A').padEnd(8)} │`,
    );
  }

  console.log(
    '└────┴─────────────────────────────────┴─────────────────────────┴──────────────┴──────────┘',
  );

  // Exportar a JSON
  const jsonOutput = JSON.stringify(data, null, 2);
  fs.writeFileSync('current-positions.json', jsonOutput);
  console.log('\n✅ Exportado a: current-positions.json');

  // Exportar a CSV
  const csvHeaders =
    'Position,Name,Username,Email,Phone,Immune Until,Vulnerable Until\n';
  const csvRows = data
    .map(
      (p) =>
        `${p.position},"${p.name}",${p.username},${p.email},${p.phone || ''},${p.immune_until || ''},${p.vulnerable_until || ''}`,
    )
    .join('\n');

  fs.writeFileSync('current-positions.csv', csvHeaders + csvRows);
  console.log('✅ Exportado a: current-positions.csv');

  // Exportar script de TypeScript listo para usar
  const tsScript = `// Posiciones actuales extraídas el ${new Date().toISOString()}
const newPositions: { [key: string]: number } = {
${data.map((p) => `  '${p.username}': ${p.position}, // ${p.name}`).join('\n')}
};`;

  fs.writeFileSync('current-positions.ts', tsScript);
  console.log('✅ Exportado a: current-positions.ts\n');

  console.log('📋 Total de jugadores:', players.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
