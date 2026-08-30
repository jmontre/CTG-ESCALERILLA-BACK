import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

interface Jugador {
  nombre: string;
  email: string;
  telefono: string;
  posicion?: number;
}

// Función para generar username desde nombre completo
function generateUsername(
  nombre: string,
  existingUsernames: Set<string>,
): string {
  // Limpiar y normalizar
  const parts = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
    .replace(/[^a-z0-9\s]/g, '') // Solo letras y espacios
    .split(/\s+/)
    .filter((p) => p.length > 0);

  if (parts.length === 0) return 'usuario';

  // Intentar nombre + apellido
  let username = parts.join('');

  if (!existingUsernames.has(username)) {
    return username;
  }

  // Si existe, agregar número
  let counter = 1;
  while (existingUsernames.has(`${username}${counter}`)) {
    counter++;
  }

  return `${username}${counter}`;
}

// Orden según imagen (posiciones 1-32 visibles + resto al final)
const rankingOrden = [
  'Claudio Pinilla', // 1
  'Juan Pablo Morales',
  'Ismael soto',
  'Lester Montre', // 2, 3, 4
  'Hernán Rojas',
  'Claudio Pineda',
  'Gerardo Galdame',
  'Piero Cantillana Godoy', // 5-8
  'Héctor Mondaca',
  'Diego Quijada',
  'Diego Suárez',
  'CRISTIAN ORDOÑEZ', // 9-12
  'Cristián González',
  'Oscar Eliseo Perez Perez',
  'Randolfo Tapia',
  'Luis enrique miranda lorca',
  'Rodrigo Becerra', // 13-17
  'Gonzalo carbacho',
  'Rodrigo Saez',
  'Luis Raúl Correa',
  'Oscar Pérez Jr',
  'Vicente Soto', // 18-22
  'Gerardo Pérez',
  'Mateo Carvacho',
  'Daniel Soto muñoz',
  'Gustavo Díaz',
  'Leandro Lobos',
  'Diego Fuenzalida', // 23-28
  'Juan Parraguez',
  'Carlos Guzmán',
  'Diego Tapia Diaz',
  'Daniel Soto', // 29-32
];

const jugadores: Jugador[] = [
  {
    nombre: 'Lester Montre',
    email: 'lester.montre@gmail.com',
    telefono: '961502534',
  },
  {
    nombre: 'Gerardo Galdame',
    email: 'gerardogaldame12@gmail.com',
    telefono: '982463103',
  },
  {
    nombre: 'Gustavo Díaz',
    email: 'gustavodiazv@live.com',
    telefono: '977487366',
  },
  {
    nombre: 'Oscar Eliseo Perez Perez',
    email: 'oscareliseo1962@gmail.com',
    telefono: '985860915',
  },
  {
    nombre: 'Rodrigo Becerra',
    email: 'C_rodrigo21@hotmail.com',
    telefono: '983432259',
  },
  {
    nombre: 'Piero Cantillana Godoy',
    email: 'piero.cantillana@gmail.com',
    telefono: '997825182',
  },
  {
    nombre: 'Ismael soto',
    email: 'ismaels20@gmail.com',
    telefono: '966333450',
  },
  {
    nombre: 'Héctor Mondaca',
    email: 'Hectormg2007@gmail.com',
    telefono: '937370712',
  },
  {
    nombre: 'Marco robles',
    email: 'casabetel@redvida.cl',
    telefono: '982971725',
  },
  {
    nombre: 'Bastian Becerra',
    email: 'Cbecerra@saldana.cl',
    telefono: '930711935',
  },
  { nombre: 'Felipe Soto', email: 'fsotoo@gmail.com', telefono: '987895344' },
  {
    nombre: 'Fernando Moreno',
    email: 'fmorenogutierrez178@gmail.com',
    telefono: '965737769',
  },
  {
    nombre: 'Diego Fuenzalida',
    email: 'diegofuenzalida88@gmail.com',
    telefono: '996915269',
  },
  {
    nombre: 'Leandro Lobos',
    email: 'leandro.lobos18@gmail.com',
    telefono: '995596226',
  },
  {
    nombre: 'Nicolas baeza morales',
    email: 'nicolasbaezamorales@gmail.com',
    telefono: '961447315',
  },
  {
    nombre: 'Diego Suárez',
    email: 'diegosuarezcespedes@gmail.com',
    telefono: '985451286',
  },
  {
    nombre: 'Diego Quijada',
    email: 'diegoquijadao@gmail.com',
    telefono: '959381291',
  },
  {
    nombre: 'Juan Pablo Morales',
    email: 'jpablomoralesvalenzuela.19@gmail.com',
    telefono: '971319045',
  },
  {
    nombre: 'Claudio Pineda',
    email: 'cpinedaq@gmail.com',
    telefono: '966565562',
  },
  {
    nombre: 'Javier Montre',
    email: 'javier.montre.m@gmail.com',
    telefono: '975126711',
  },
  {
    nombre: 'CRISTIAN ORDOÑEZ',
    email: 'servicioscontanc@gmail.com',
    telefono: '976294004',
  },
  {
    nombre: 'Robert Quezada',
    email: 'robert.quezada@gmail.com',
    telefono: '999433272',
  },
  {
    nombre: 'Joaquín Quezada',
    email: 'joaquinyoshi216@gmail.com',
    telefono: '944424420',
  },
  {
    nombre: 'Jose Silva',
    email: 'silvalobos@icloud.com',
    telefono: '983042988',
  },
  {
    nombre: 'Juan Carlos tobar Villanueva',
    email: 'jctobarkine@gmail.com',
    telefono: '998831334',
  },
  {
    nombre: 'Claudio Pinilla',
    email: 'pinilla.claudio@gmail.com',
    telefono: '977648618',
  },
  {
    nombre: 'Cristián González',
    email: 'cgonzalezpa@gmail.com',
    telefono: '993194389',
  },
  {
    nombre: 'Carlos Guzmán',
    email: 'carlosgzmn599@gmail.com',
    telefono: '962650446',
  },
  {
    nombre: 'Gonzalo carbacho',
    email: 'goncar.apr@gmail.com',
    telefono: '957921822',
  },
  {
    nombre: 'Juan Parraguez',
    email: 'juan.parraguez02@gmail.com',
    telefono: '998102567',
  },
  {
    nombre: 'Randolfo Tapia',
    email: 'Randolfotapia@gmail.com',
    telefono: '990737329',
  },
  {
    nombre: 'Luis enrique miranda lorca',
    email: 'luismirandalorca@hotmail.com',
    telefono: '982606145',
  },
  {
    nombre: 'Alonso Becerra',
    email: 'alonso.becerra.riquelme01@gmail.com',
    telefono: '984306279',
  },
  {
    nombre: 'Benjamin Moreno',
    email: 'benjamorenoh22@gmail.com',
    telefono: '998118106',
  },
  {
    nombre: 'Luis Raúl Correa',
    email: 'lraulcorrea.lrcp@gmail.com',
    telefono: '961522404',
  },
  {
    nombre: 'Esteban Miranda',
    email: 'esteban8247@gmail.com',
    telefono: '965015823',
  },
  {
    nombre: 'Daniel Soto muñoz',
    email: 'danielsoto.m94@gmail.com',
    telefono: '993343013',
  },
  {
    nombre: 'Gerardo Pérez',
    email: 'gerald.ohio@gmail.com',
    telefono: '999577231',
  },
  {
    nombre: 'Daniel Muñoz',
    email: 'dmunozcamilla@gmail.com',
    telefono: '988110789',
  },
  {
    nombre: 'Maximiliano Gonzalez',
    email: 'maximmetri@gmail.com',
    telefono: '976080805',
  },
  {
    nombre: 'Jorge Pinilla',
    email: 'Georgluis@hotmail.com',
    telefono: '941945577',
  },
  {
    nombre: 'Vicente Soto',
    email: 'viceentesoto06@hotmail.com',
    telefono: '953927011',
  },
  {
    nombre: 'Cristobal Prado',
    email: 'cristobal.o.p.pinto@gmail.com',
    telefono: '953025480',
  },
  {
    nombre: 'Daniel Soto',
    email: 'daniel.soto@cleanlove.cl',
    telefono: '990591559',
  },
  {
    nombre: 'Gincarlo Stipo',
    email: 'gstipo70@gmail.com',
    telefono: '984649527',
  },
  {
    nombre: 'Diego Tapia Diaz',
    email: 'diego.td@gmail.com',
    telefono: '997864026',
  },
  {
    nombre: 'Hernán Rojas',
    email: 'hernan.rojas@precision.tech',
    telefono: '944446620',
  },
  {
    nombre: 'MARIANNO STIPO',
    email: 'Macstipo1@gmail.com',
    telefono: '973344032',
  },
];

async function main() {
  console.log('🗑️  Limpiando datos existentes...');

  await prisma.rankingHistory.deleteMany();
  await prisma.challenge.deleteMany();
  await prisma.player.deleteMany();
  await prisma.user.deleteMany();

  console.log('✅ Datos eliminados\n');

  const jugadoresMap = new Map<string, Jugador>();
  jugadores.forEach((j) => jugadoresMap.set(j.nombre, j));

  const jugadoresOrdenados: Jugador[] = [];
  let posicion = 1;

  for (const nombre of rankingOrden) {
    const jugador = jugadoresMap.get(nombre);
    if (jugador) {
      jugadoresOrdenados.push({ ...jugador, posicion });
      posicion++;
      jugadoresMap.delete(nombre);
    }
  }

  jugadoresMap.forEach((jugador) => {
    jugadoresOrdenados.push({ ...jugador, posicion });
    posicion++;
  });

  console.log(`👥 Cargando ${jugadoresOrdenados.length} jugadores...\n`);

  const adminPassword = await bcrypt.hash('admin123', 10);
  const adminUser = await prisma.user.create({
    data: {
      username: 'admin',
      email: 'admin@ctg.cl',
      password_hash: adminPassword,
      is_admin: true,
    },
  });

  await prisma.player.create({
    data: {
      user_id: adminUser.id,
      name: 'Administrador CTG',
      email: 'admin@ctg.cl',
      position: 0,
    },
  });

  console.log('✅ Admin creado (admin / admin123)\n');

  const existingUsernames = new Set<string>(['admin']);

  for (const jugador of jugadoresOrdenados) {
    const username = generateUsername(jugador.nombre, existingUsernames);
    existingUsernames.add(username);

    const password = await bcrypt.hash('ctg2026', 10);

    const user = await prisma.user.create({
      data: {
        username,
        email: jugador.email,
        password_hash: password,
        is_admin: false,
      },
    });

    await prisma.player.create({
      data: {
        user_id: user.id,
        name: jugador.nombre,
        email: jugador.email,
        phone: jugador.telefono,
        position: jugador.posicion!,
      },
    });

    console.log(
      `  ${jugador.posicion}. ${jugador.nombre.padEnd(35)} → @${username}`,
    );
  }

  console.log(
    `\n✅ ${jugadoresOrdenados.length} jugadores cargados correctamente!`,
  );
  console.log('\n📋 Contraseña por defecto: ctg2026');
  console.log('💡 Los jugadores pueden hacer login con su username O email');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
