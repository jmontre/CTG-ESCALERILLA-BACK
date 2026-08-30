/**
 * Utilidades compartidas por los scripts de cierre de temporada.
 *
 * Todos corren en modo simulación por defecto: hay que pasar `--apply`
 * explícitamente para escribir en la base. Estos scripts se ejecutan contra
 * producción, así que el default seguro no es negociable.
 */

export interface RunMode {
  apply: boolean;
}

export function parseArgs(argv: string[]): RunMode & { rest: string[] } {
  const apply = argv.includes('--apply');
  const rest = argv.filter((a) => a !== '--apply' && !a.startsWith('--'));
  return { apply, rest };
}

export function banner(title: string, apply: boolean) {
  console.log('');
  console.log(`━━━ ${title} ━━━`);
  console.log(
    apply
      ? '⚠️  MODO APLICAR — se va a escribir en la base'
      : '🔍 SIMULACIÓN — no se escribe nada (agrega --apply para ejecutar)',
  );
  console.log('');
}

export function done(apply: boolean) {
  console.log('');
  console.log(
    apply
      ? '✅ Listo. Cambios aplicados.'
      : '🔍 Simulación terminada. Nada fue modificado. Repite con --apply.',
  );
}

/** Normaliza un nombre para comparar: sin tildes, minúsculas, sin puntuación. */
export function normalizeName(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}
