/**
 * Catálogo de logros. Vive en código a propósito: agregar un logro nuevo es
 * una entrada en este arreglo, sin migración ni seed.
 *
 * `code` es la llave que se guarda en `player_achievements.code` — NUNCA
 * cambiar el code de un logro ya otorgado: los desbloqueos quedarían huérfanos.
 *
 * `scope`:
 *   - 'season' → se otorga una vez por temporada (season_slug = "2026-2")
 *   - 'global' → se otorga una sola vez en la vida (season_slug = "global")
 */

export type AchievementScope = 'season' | 'global';
export type AchievementGroup =
  | 'temporada'
  | 'escalerilla'
  | 'partidos'
  | 'constancia'
  | 'club';

export interface AchievementDef {
  code: string;
  name: string;
  /** Cómo se consigue. Se muestra bajo la insignia bloqueada. */
  description: string;
  emoji: string;
  group: AchievementGroup;
  scope: AchievementScope;
  /** Para logros escalonados (racha 3/5/10): mismo `family`, tier creciente. */
  family?: string;
  tier?: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ─────────────────────────── Temporada ───────────────────────────
  {
    code: 'campeon',
    name: 'Campeón',
    description: 'Ganar la final de tu categoría en el Master de la temporada.',
    emoji: '🏆',
    group: 'temporada',
    scope: 'season',
  },
  {
    code: 'finalista',
    name: 'Finalista',
    description: 'Llegar a la final de tu categoría en el Master.',
    emoji: '🥈',
    group: 'temporada',
    scope: 'season',
  },
  {
    code: 'semifinalista',
    name: 'Semifinalista',
    description: 'Clasificar a las semifinales de tu categoría.',
    emoji: '🎖️',
    group: 'temporada',
    scope: 'season',
  },

  // ────────────────────────── Escalerilla ──────────────────────────
  {
    code: 'cima',
    name: 'Cima',
    description: 'Alcanzar el puesto #1 de la escalerilla.',
    emoji: '👑',
    group: 'escalerilla',
    scope: 'season',
  },
  {
    code: 'ascenso',
    name: 'Ascenso',
    description:
      'Subir de categoría durante el semestre (de D a C, C a B o B a A).',
    emoji: '⬆️',
    group: 'escalerilla',
    scope: 'season',
  },
  {
    code: 'escalador',
    name: 'Escalador',
    description:
      'Subir 10 puestos respecto a tu posición inicial del semestre.',
    emoji: '🚀',
    group: 'escalerilla',
    scope: 'season',
    family: 'escalador',
    tier: 1,
  },
  {
    code: 'alpinista',
    name: 'Alpinista',
    description:
      'Subir 20 puestos respecto a tu posición inicial del semestre.',
    emoji: '🧗',
    group: 'escalerilla',
    scope: 'season',
    family: 'escalador',
    tier: 2,
  },
  {
    code: 'batacazo',
    name: 'Batacazo',
    description:
      'Ganarle a alguien que estaba 5 o más puestos por encima tuyo.',
    emoji: '🎯',
    group: 'escalerilla',
    scope: 'season',
  },
  {
    code: 'muralla',
    name: 'Muralla',
    description:
      'Defender tu posición 3 veces seguidas: ganar 3 desafíos recibidos al hilo.',
    emoji: '🛡️',
    group: 'escalerilla',
    scope: 'season',
  },

  // ─────────────────────────── Partidos ────────────────────────────
  {
    code: 'debut',
    name: 'Debut',
    description: 'Jugar tu primer partido del semestre. ¡Ya estás en carrera!',
    emoji: '🎾',
    group: 'partidos',
    scope: 'season',
  },
  {
    code: 'racha_3',
    name: 'En llamas',
    description: 'Ganar 3 partidos seguidos.',
    emoji: '🔥',
    group: 'partidos',
    scope: 'season',
    family: 'racha',
    tier: 1,
  },
  {
    code: 'racha_5',
    name: 'Imparable',
    description: 'Ganar 5 partidos seguidos.',
    emoji: '💥',
    group: 'partidos',
    scope: 'season',
    family: 'racha',
    tier: 2,
  },
  {
    code: 'racha_10',
    name: 'Intocable',
    description: 'Ganar 10 partidos seguidos.',
    emoji: '⚡',
    group: 'partidos',
    scope: 'season',
    family: 'racha',
    tier: 3,
  },
  {
    code: 'guerrero',
    name: 'Guerrero',
    description: 'Jugar 10 partidos en el semestre, ganes o pierdas.',
    emoji: '⚔️',
    group: 'partidos',
    scope: 'season',
  },
  {
    code: 'rosquilla',
    name: 'Rosquilla',
    description: 'Ganar un partido 6-0 6-0.',
    emoji: '🍩',
    group: 'partidos',
    scope: 'season',
  },
  {
    code: 'maratonista',
    name: 'Maratonista',
    description: 'Ganar un partido definido en super tiebreak.',
    emoji: '⏱️',
    group: 'partidos',
    scope: 'season',
  },
  {
    code: 'remontada',
    name: 'Remontada',
    description: 'Ganar un partido después de perder el primer set.',
    emoji: '🧠',
    group: 'partidos',
    scope: 'season',
  },

  // ────────────────────────── Constancia ───────────────────────────
  {
    code: 'semana_perfecta',
    name: 'Semana perfecta',
    description: 'Jugar al menos un partido en 3 semanas seguidas.',
    emoji: '📅',
    group: 'constancia',
    scope: 'season',
  },
  {
    code: 'mes_redondo',
    name: 'Mes redondo',
    description:
      'Jugar al menos un partido en 4 semanas distintas de un mismo mes.',
    emoji: '🗓️',
    group: 'constancia',
    scope: 'season',
  },
  {
    code: 'relojito',
    name: 'Relojito',
    description: 'Jugar al menos un partido en cada mes del semestre.',
    emoji: '🎯',
    group: 'constancia',
    scope: 'season',
  },
  {
    code: 'anfitrion',
    name: 'Anfitrión',
    description: 'Traer 3 visitas distintas a la cancha.',
    emoji: '🌐',
    group: 'constancia',
    scope: 'season',
  },
  {
    code: 'madrugador',
    name: 'Madrugador',
    description: 'Jugar en el primer turno del día (06:00).',
    emoji: '⏰',
    group: 'constancia',
    scope: 'season',
  },
  {
    code: 'nocturno',
    name: 'Nocturno',
    description: 'Jugar en el último turno del día (21:45).',
    emoji: '🦉',
    group: 'constancia',
    scope: 'season',
  },

  // ───────────────────────────── Club ──────────────────────────────
  {
    code: 'sociable',
    name: 'Sociable',
    description: 'Enfrentar a 10 rivales distintos.',
    emoji: '🤝',
    group: 'club',
    scope: 'global',
  },
  {
    code: 'aniversario',
    name: 'Aniversario',
    description: 'Cumplir un año en el club.',
    emoji: '🎂',
    group: 'club',
    scope: 'global',
  },
];

export const ACHIEVEMENTS_BY_CODE = new Map(
  ACHIEVEMENTS.map((a) => [a.code, a]),
);

export const GROUP_LABELS: Record<AchievementGroup, string> = {
  temporada: 'Temporada',
  escalerilla: 'Escalerilla',
  partidos: 'Partidos',
  constancia: 'Constancia',
  club: 'Club',
};
