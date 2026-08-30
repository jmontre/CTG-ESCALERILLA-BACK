import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Ejemplo: actualizar algunos jugadores con teléfono
  await prisma.player.update({
    where: { position: 1 },
    data: { phone: '56912345678' }, // Claudio Pinilla
  });

  await prisma.player.update({
    where: { position: 2 },
    data: { phone: '56987654321' }, // Ismael Soto
  });

  console.log('✅ Teléfonos agregados');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
