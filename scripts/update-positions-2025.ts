import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Actualizando posiciones Escalerilla 2025 2º Semestre...\n');

  // Mapeo: username -> nueva posición
  const newPositions: { [key: string]: number } = {
    // CATEGORIA A
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

    // CATEGORIA B
    rodrigobecerra: 13,
    diegosuarez: 14,
    luiscorrea: 15,
    luismiranda: 16,
    cristianordonez: 17,
    randolfotapia: 18,
    gonzalocarvacho: 19,
    rodrigosaez: 20,
    gerardoperez: 21,
    oscarperezjr: 22,

    // CATEGORIA C
    gustavodiaz: 23,
    vicentesoto: 24,
    mateocarvacho: 25,
    danielsotojr: 26,
    leandrolobos: 27,
    diegofuenzalida: 28,
    juanpablourtubia: 29,
    carlosguzman: 30,
    diegotapia: 31,
    danielsoto: 32,

    // CATEGORIA D
    juanparraguez: 33,
    marcorobledo: 34,
    bastianbecerra: 35,
    felipesoto: 36,
    fernandomoreno: 37,
    nicolasbaeza: 38,
    javiermontre: 39,
    robertquezada: 40,
    joaquinquezada: 41,
    josesilva: 42,
    juancarlostobares: 43,
    alonsobecerra: 44,
    benjaminmoreno: 45,
    estebanmiranda: 46,
    danielmunoz: 47,
    maximilianogonzalez: 48,
  };

  console.log('PASO 1: Moviendo todos a posiciones temporales (1000+)...\n');

  // Paso 1: Mover todos a posiciones temporales
  const allPlayers = await prisma.player.findMany({
    include: { user: true },
  });

  for (const player of allPlayers) {
    await prisma.player.update({
      where: { id: player.id },
      data: { position: 1000 + player.position },
    });
  }

  console.log('✅ Todos los jugadores movidos a posiciones temporales\n');
  console.log('PASO 2: Asignando nuevas posiciones...\n');

  let updated = 0;
  let notFound: string[] = [];

  // Paso 2: Asignar nuevas posiciones
  for (const [username, position] of Object.entries(newPositions)) {
    const player = await prisma.player.findFirst({
      where: {
        user: {
          username: username,
        },
      },
      include: {
        user: true,
      },
    });

    if (player) {
      await prisma.player.update({
        where: { id: player.id },
        data: { position: position },
      });
      console.log(
        `✅ ${position.toString().padStart(2, ' ')}. ${player.name.padEnd(30)} (${username})`,
      );
      updated++;
    } else {
      notFound.push(username);
      console.log(`❌ NO ENCONTRADO: ${username}`);
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
