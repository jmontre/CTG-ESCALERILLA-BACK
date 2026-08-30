/**
 * Carga el orden de una temporada nueva desde la planilla de inscripción.
 *
 *   npx ts-node scripts/load-ranking-xlsx.ts "<ruta.xlsx>"            # simula
 *   npx ts-node scripts/load-ranking-xlsx.ts "<ruta.xlsx>" --apply    # aplica
 *
 * Lee la hoja "Ranking" (o la segunda, si no existe una con ese nombre) con
 * columnas: A = N° | B = Nombre y apellido | C = Correo | D = Teléfono.
 *
 * Qué hace:
 *   1. Matchea cada fila con un jugador existente por correo + nombre.
 *      El correo SOLO no alcanza: hay familias que comparten casilla (Gonzalo
 *      y Mateo Carbacho usan la misma), así que se desempata por nombre.
 *   2. Si queda alguna fila sin resolver, ABORTA sin escribir nada y lista los
 *      casos. Es preferible a adivinar y dejar el ranking cruzado.
 *   3. Renumera 1..N respetando el orden de la planilla — el N° de la columna
 *      puede venir con huecos o repetido (en la del 2do semestre el 45 estaba
 *      dos veces y no había 44).
 *   4. Los jugadores que NO aparecen quedan fuera de la escalerilla
 *      (position = null). Conservan cuenta, historial y logros.
 *   5. Resetea el récord del semestre (victorias, derrotas, partidos) y las
 *      inmunidades/vulnerabilidades vigentes.
 *   6. Abre la temporada nueva y registra la posición inicial de cada uno.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { readXlsx } from './lib/xlsx';
import { SeasonsService } from '../src/seasons/seasons.service';
import { AchievementsService } from '../src/achievements/achievements.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  parseArgs,
  banner,
  done,
  normalizeName,
  normalizeEmail,
} from './lib/cli';

const NEW_SEASON_SLUG = '2026-2';
const NEW_SEASON_NAME = 'Escalerilla 2026 · 2do Semestre';
const DEFAULT_PASSWORD = 'ctg2026';

/**
 * Nombres de la planilla que no coinciden con la base y no se pueden deducir.
 * Cada alias fue confirmado con el club: no inventar entradas acá.
 */
const ALIASES: Record<string, string> = {
  kako: 'Marco Roman',
};

const prisma = new PrismaClient();
const p = prisma as unknown as PrismaService;
const seasons = new SeasonsService(
  p,
  new AchievementsService(p, new NotificationsService(p)),
);

interface SheetRow {
  order: number;
  n: string;
  name: string;
  email: string;
  phone: string;
}

interface DbPlayer {
  id: string;
  name: string;
  email: string;
  position: number | null;
}

/** Distancia de edición, para tolerar erratas de tipeo en apellidos. */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** "carvacho" ≈ "carbacho": una letra de diferencia en palabras largas. */
function similarWord(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 1;
}

/**
 * "jp" ≈ "juan pablo": el club registra a varios socios por sus iniciales.
 * Solo aplica a tokens de 2 letras, que es el patrón real (JP Morales, JP Urtubia).
 */
function isInitialism(short: string[], long: string[]): boolean {
  if (short.length === 0 || short[0].length !== 2 || long.length < 2)
    return false;
  return short[0] === long[0][0] + long[1][0];
}

/**
 * ¿Estos dos nombres son la misma persona?
 * Mismo primer nombre (o iniciales) + algún apellido en común, tolerando una
 * letra de diferencia. Deliberadamente conservador: ante la duda el script
 * aborta y pide confirmación humana en vez de cruzar dos jugadores.
 */
function nameMatches(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na.length === 0 || nb.length === 0) return false;

  // Cuántos tokens ocupa el nombre de pila en cada lado. Con iniciales ("jp"),
  // el lado largo gasta dos ("juan pablo") y el corto uno.
  let takeA = 1;
  let takeB = 1;
  if (similarWord(na[0], nb[0])) {
    // nombres de pila equivalentes, un token cada uno
  } else if (isInitialism(na, nb)) {
    takeB = 2;
  } else if (isInitialism(nb, na)) {
    takeA = 2;
  } else {
    return false;
  }

  const surnamesA = na.slice(takeA);
  const surnamesB = nb.slice(takeB);
  // Si alguno viene solo con nombre de pila, no hay apellido que contrastar.
  if (surnamesA.length === 0 || surnamesB.length === 0) return true;

  return surnamesA.some((w) => surnamesB.some((x) => similarWord(w, x)));
}

function readSheet(path: string): SheetRow[] {
  const sheets = readXlsx(path);
  const sheet = sheets.find((s) => /ranking/i.test(s.name)) ?? sheets[1];
  if (!sheet)
    throw new Error('No encontré la hoja "Ranking" (ni una segunda hoja)');
  console.log(`Hoja leída: "${sheet.name}" (${sheet.rows.length} filas)\n`);

  const rows: SheetRow[] = [];
  for (const raw of sheet.rows) {
    const n = (raw.A ?? '').trim();
    const name = (raw.B ?? '').trim();
    if (!name || !/^\d+$/.test(n)) continue; // encabezado y filas vacías
    rows.push({
      order: rows.length,
      n,
      name,
      email: normalizeEmail(raw.C),
      phone: (raw.D ?? '').trim(),
    });
  }
  return rows;
}

type Resolution =
  | { player: DbPlayer; via: 'correo' | 'nombre' | 'correo (nombre distinto)' }
  | { ambiguous: DbPlayer[] }
  | null;

function resolve(row: SheetRow, players: DbPlayer[]): Resolution {
  const target = ALIASES[row.name.trim().toLowerCase()] ?? row.name;

  // 1) Por correo. Puede devolver más de uno: hay familias que comparten
  //    casilla (Gonzalo y Mateo Carbacho), y ahí el correo no decide nada.
  if (row.email) {
    const byEmail = players.filter(
      (p) => normalizeEmail(p.email) === row.email,
    );
    const alsoByName = byEmail.filter((p) => nameMatches(p.name, target));

    if (alsoByName.length === 1)
      return { player: alsoByName[0], via: 'correo' };
    if (byEmail.length === 1 && alsoByName.length === 0) {
      // Correo único en la base pero el nombre no calza: casi siempre es la
      // misma persona registrada con otro nombre. Se acepta y se avisa.
      return { player: byEmail[0], via: 'correo (nombre distinto)' };
    }
    if (byEmail.length > 1 && alsoByName.length !== 1) {
      return { ambiguous: byEmail };
    }
  }

  // 2) Por nombre.
  const byName = players.filter((p) => nameMatches(p.name, target));
  if (byName.length === 1) return { player: byName[0], via: 'nombre' };
  if (byName.length > 1) return { ambiguous: byName };
  return null;
}

async function main() {
  const { apply, rest } = parseArgs(process.argv.slice(2));
  const path = rest[0];
  if (!path) {
    console.error(
      'Uso: npx ts-node scripts/load-ranking-xlsx.ts "<ruta.xlsx>" [--apply]',
    );
    process.exit(1);
  }
  banner(`Cargar ranking ${NEW_SEASON_SLUG} desde ${path}`, apply);

  const rows = readSheet(path);
  const players: DbPlayer[] = await prisma.player.findMany({
    where: { user: { is_admin: false } },
    select: { id: true, name: true, email: true, position: true },
  });

  const matched = new Map<string, { row: SheetRow; player: DbPlayer }>();
  const toCreate: SheetRow[] = [];
  const unresolved: Array<{ row: SheetRow; reason: string }> = [];
  const warnings: string[] = [];

  for (const row of rows) {
    const found = resolve(row, players);

    if (found && 'player' in found) {
      const already = matched.get(found.player.id);
      if (already) {
        unresolved.push({
          row,
          reason: `choca con la fila N°${already.row.n} (${already.row.name}) — ambas apuntan a ${found.player.name}`,
        });
        continue;
      }
      matched.set(found.player.id, { row, player: found.player });
      if (
        found.via !== 'correo' &&
        found.player.name.trim() !== row.name.trim()
      ) {
        warnings.push(
          `N°${row.n} "${row.name}" → "${found.player.name}" (por ${found.via})`,
        );
      }
    } else if (found && 'ambiguous' in found) {
      unresolved.push({
        row,
        reason: `coincide con varios: ${found.ambiguous.map((p) => p.name).join(', ')}`,
      });
    } else if (row.email) {
      toCreate.push(row);
    } else {
      unresolved.push({
        row,
        reason: 'no existe en la base y la planilla no trae correo',
      });
    }
  }

  // ── Reporte ──
  const ordered = rows
    .map((row) => {
      const hit = [...matched.values()].find((m) => m.row === row);
      return { row, player: hit?.player ?? null };
    })
    .filter((x) => x.player || toCreate.includes(x.row));

  console.log('── ORDEN NUEVO ──');
  ordered.forEach((x, i) => {
    const pos = i + 1;
    const before = x.player?.position;
    const delta = before
      ? before === pos
        ? '='
        : before > pos
          ? `↑${before - pos}`
          : `↓${pos - before}`
      : x.player
        ? 'entra' // ya tenía cuenta, estaba fuera de la escalerilla
        : 'nuevo'; // se crea la cuenta
    console.log(
      `  #${String(pos).padStart(2)}  ${(x.player?.name ?? x.row.name).padEnd(26)} ` +
        `${before ? `(era #${before})`.padEnd(15) : '(sin posición)'.padEnd(15)} ${delta}`,
    );
  });

  if (warnings.length) {
    console.log(
      '\n── ⚠️  MATCHEOS A REVISAR (el nombre de la planilla no es idéntico) ──',
    );
    for (const w of warnings) console.log(`  ${w}`);
  }

  const leaving = players.filter(
    (p) => p.position != null && p.position < 1000 && !matched.has(p.id),
  );
  if (leaving.length) {
    console.log(
      '\n── SALEN DE LA ESCALERILLA (conservan cuenta e historial) ──',
    );
    for (const p of leaving.sort((a, b) => a.position! - b.position!)) {
      console.log(`  #${String(p.position).padStart(2)}  ${p.name}`);
    }
  }

  if (toCreate.length) {
    console.log('\n── JUGADORES NUEVOS (se crean con cuenta) ──');
    for (const r of toCreate)
      console.log(
        `  N°${r.n} ${r.name} · ${r.email} · ${r.phone || 'sin teléfono'}`,
      );
  }

  if (unresolved.length) {
    console.log('\n── ❌ SIN RESOLVER ──');
    for (const u of unresolved)
      console.log(`  N°${u.row.n} ${u.row.name}: ${u.reason}`);
    console.log(
      '\nAborto: resuelve estos casos en la planilla (o en ALIASES) antes de aplicar.',
    );
    console.log('No se escribió nada.');
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nResumen: ${ordered.length} en la escalerilla · ${toCreate.length} nuevos · ${leaving.length} salen`,
  );
  if (!apply) return;

  // ── Aplicar ──
  const existingUsernames = new Set(
    (await prisma.user.findMany({ select: { username: true } })).map(
      (u) => u.username,
    ),
  );
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const finalOrder: Array<{ id: string; position: number }> = [];
  let position = 0;

  for (const x of ordered) {
    position++;
    if (x.player) {
      finalOrder.push({ id: x.player.id, position });
      continue;
    }
    // Jugador nuevo: usuario + player.
    const base = normalizeName(x.row.name).join('') || 'jugador';
    let username = base;
    let n = 1;
    while (existingUsernames.has(username)) username = `${base}${n++}`;
    existingUsernames.add(username);

    const created = await prisma.player.create({
      data: {
        name: x.row.name,
        email: x.row.email,
        phone: x.row.phone
          ? `+56${x.row.phone.replace(/\D/g, '').slice(-9)}`
          : null,
        position,
        user: {
          create: { username, email: x.row.email, password_hash: passwordHash },
        },
      },
    });
    console.log(
      `  + creado ${x.row.name} (usuario "${username}", clave "${DEFAULT_PASSWORD}")`,
    );
    finalOrder.push({ id: created.id, position });
  }

  // Pivot a 9000+ y luego a destino: evita colisiones intermedias.
  await prisma.$transaction([
    ...finalOrder.map((f, i) =>
      prisma.player.update({
        where: { id: f.id },
        data: { position: 9000 + i },
      }),
    ),
    ...leaving.map((l) =>
      prisma.player.update({ where: { id: l.id }, data: { position: null } }),
    ),
    ...finalOrder.map((f) =>
      prisma.player.update({
        where: { id: f.id },
        data: {
          position: f.position,
          wins: 0,
          losses: 0,
          total_matches: 0,
          immune_until: null,
          vulnerable_until: null,
        },
      }),
    ),
  ]);

  // Los que salen también arrancan con el récord limpio.
  await prisma.player.updateMany({
    where: { id: { in: leaving.map((l) => l.id) } },
    data: {
      wins: 0,
      losses: 0,
      total_matches: 0,
      immune_until: null,
      vulnerable_until: null,
    },
  });

  const opened = await seasons.openSeason(NEW_SEASON_SLUG, NEW_SEASON_NAME);
  console.log(
    `\nTemporada "${opened.season.slug}" abierta con ${opened.players} posiciones iniciales registradas.`,
  );
}

main()
  .then(() => done(process.argv.includes('--apply')))
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
