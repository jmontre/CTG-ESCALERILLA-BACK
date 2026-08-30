import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📱 Actualizando formato de teléfonos...\n');

  const players = await prisma.player.findMany({
    where: {
      phone: {
        not: null,
      },
    },
  });

  let updated = 0;

  for (const player of players) {
    if (!player.phone) continue;

    let newPhone = player.phone.trim();

    // Si NO empieza con +56, agregarlo
    if (!newPhone.startsWith('+56')) {
      // Si empieza con 9, agregar +56
      if (newPhone.startsWith('9')) {
        newPhone = '+56' + newPhone;
      } else {
        console.warn(
          `⚠️  ${player.name}: ${player.phone} (formato sospechoso)`,
        );
        continue;
      }

      await prisma.player.update({
        where: { id: player.id },
        data: { phone: newPhone },
      });

      console.log(`✅ ${player.name}: ${player.phone} → ${newPhone}`);
      updated++;
    } else {
      console.log(`⏭️  ${player.name}: ${player.phone} (ya está correcto)`);
    }
  }

  console.log(`\n✅ ${updated} teléfonos actualizados!`);
  console.log(`📊 Total verificados: ${players.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
