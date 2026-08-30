import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updatePositionsOnly() {
  console.log(
    '🔄 Actualizando SOLO posiciones (sin tocar nombres, emails, etc)...\n',
  );

  // Mapeo: username -> nueva posición
  const newPositions: { [key: string]: number } = {
    ismaelsoto: 1,
    claudiopinilla: 2,
    juanpablomorales: 3,
    hernanrojas: 4,
    gerardogaldame: 5,
    lestermontre: 6,
    claudiopineda: 7,
    hectormondaca: 8,
    pierocantillana: 9,
    cristiangonzalez: 10,
    oscarperez: 11,
    diegoquijada: 12,
    carlosbecerra: 13,
    diegosuarez: 14,
    luiscorrea: 15,
    luismiranda: 16,
    cristianordonez: 17,
    randolfotapia: 18,
    gonzalocarbacho: 19,
    gerardoperez: 20,
    gustavodiaz: 21,
    vicentesoto: 22,
    danielsotomunoz: 23,
    leandrolobos: 24,
    diegofuenzalida: 25,
    carlosguzman: 26,
    diegotapia: 27,
    danielsoto: 28,
    juanparraguez: 29,
    bastianbecerra: 30,
    felipesoto: 31,
    marcorobles: 32,
    juantobar: 33,
    jorgepinilla: 34,
    cristobalprado: 35,
    giancarlostipo: 36,
    fernandomoreno: 37,
    nicolasbaeza: 38,
    javiermontre: 39,
    robertquezada: 40,
    joaquinquezada: 41,
    josesilva: 42,
    mariannostipo: 43,
    alonsobecerra: 44,
    benjaminmoreno: 45,
    estebanmiranda: 46,
    danielmunoz: 47,
    maximilianogonzalez: 48,
  };

  console.log('PASO 1: Moviendo a posiciones temporales...\n');

  const allPlayers = await prisma.player.findMany({
    include: { user: true },
    where: {
      user: { username: { not: 'admin' } },
    },
  });

  for (const player of allPlayers) {
    await prisma.player.update({
      where: { id: player.id },
      data: { position: 1000 + player.position },
    });
  }

  console.log('✅ Movidos a posiciones temporales\n');
  console.log('PASO 2: Asignando nuevas posiciones...\n');

  let updated = 0;

  for (const [username, newPosition] of Object.entries(newPositions)) {
    const player = await prisma.player.findFirst({
      where: { user: { username } },
      include: { user: true },
    });

    if (player) {
      await prisma.player.update({
        where: { id: player.id },
        data: { position: newPosition }, // SOLO actualiza position
      });
      console.log(
        `✅ ${newPosition.toString().padStart(2, ' ')}. ${player.name}`,
      );
      updated++;
    }
  }

  console.log(`\n✅ ${updated} posiciones actualizadas\n`);
}

updatePositionsOnly()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
