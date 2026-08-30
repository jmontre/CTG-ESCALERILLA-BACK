import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log(
    '🔄 Actualizando posiciones de la Escalerilla 2025 2º Semestre...\n',
  );

  // Nuevas posiciones según la imagen
  const newPositions = [
    { position: 1, name: 'Ismael Soto' },
    { position: 2, name: 'Claudio Pinilla' },
    { position: 3, name: 'JP Morales' },
    { position: 4, name: 'Hernan Rojas' },
    { position: 5, name: 'Gerardo Galdame' },
    { position: 6, name: 'Lester Montre' },
    { position: 7, name: 'Claudio Pineda' },
    { position: 8, name: 'Hector Mondaca' },
    { position: 9, name: 'Piero Cantillana' },
    { position: 10, name: 'Cristian Gonzalez' },
    { position: 11, name: 'Oscar Perez' },
    { position: 12, name: 'Diego Quijada' },
    { position: 13, name: 'Rodrigo Becerra' },
    { position: 14, name: 'Diego Suarez' },
    { position: 15, name: 'Luis Correa' },
    { position: 16, name: 'Luis Miranda' },
    { position: 17, name: 'Cristian Ordoñez' },
    { position: 18, name: 'Randolfo Tapia' },
    { position: 19, name: 'Gonzalo Carvacho' },
    { position: 20, name: 'Rodrigo Saez' },
    { position: 21, name: 'Gerardo Perez' },
    { position: 22, name: 'Oscar Pérez Jr' },
    { position: 23, name: 'Gustavo Diaz' },
    { position: 24, name: 'Vicente Soto' },
    { position: 25, name: 'Mateo Carvacho' },
    { position: 26, name: 'Daniel Soto Jr' },
    { position: 27, name: 'Leandro Lobos' },
    { position: 28, name: 'Diego Fuenzalida' },
    { position: 29, name: 'JP Urtubia' },
    { position: 30, name: 'Carlos Guzman' },
    { position: 31, name: 'Diego Tapia (7)' },
    { position: 32, name: 'Daniel Soto (11)' },
  ];

  let updated = 0;
  let notFound = [];

  for (const entry of newPositions) {
    const player = await prisma.player.findFirst({
      where: {
        name: {
          contains: entry.name.split(' ')[0], // Buscar por primer nombre
          mode: 'insensitive',
        },
      },
    });

    if (player) {
      await prisma.player.update({
        where: { id: player.id },
        data: { position: entry.position },
      });
      console.log(`✅ Posición ${entry.position}: ${player.name}`);
      updated++;
    } else {
      notFound.push(entry.name);
      console.log(`❌ NO ENCONTRADO: ${entry.name}`);
    }
  }

  console.log(`\n✅ ${updated} posiciones actualizadas`);

  if (notFound.length > 0) {
    console.log(`\n⚠️  ${notFound.length} jugadores NO encontrados:`);
    notFound.forEach((name) => console.log(`   - ${name}`));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
