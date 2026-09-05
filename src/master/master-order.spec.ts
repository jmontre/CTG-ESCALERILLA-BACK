import {
  applyMasterOrderToRange,
  isMasterFinished,
  masterFinalOrder,
  MasterOrderInput,
} from './master-order';

/**
 * Cuadro de ejemplo: 8 jugadores, dos grupos de 4.
 *   Grupo A: a1 (3-0), a2 (2-1), a3 (1-2), a4 (0-3)
 *   Grupo B: b1 (3-0), b2 (2-1), b3 (1-2), b4 (0-3)
 *   Semis:   a1 vs b2 → gana a1 · b1 vs a2 → gana b1
 *   Final:   a1 vs b1 → gana b1
 */
function cuadro(overrides: Partial<MasterOrderInput> = {}): MasterOrderInput {
  const gp = (id: string, wins: number, sw: number, sl: number) => ({
    player_id: id,
    wins,
    losses: 3 - wins,
    sets_won: sw,
    sets_lost: sl,
  });

  return {
    groups: [
      {
        players: [
          gp('a1', 3, 6, 1),
          gp('a2', 2, 5, 3),
          gp('a3', 1, 3, 4),
          gp('a4', 0, 0, 6),
        ],
      },
      {
        players: [
          gp('b1', 3, 6, 0),
          gp('b2', 2, 4, 3),
          gp('b3', 1, 2, 5),
          gp('b4', 0, 1, 6),
        ],
      },
    ],
    matches: [
      {
        round: 'semifinal',
        status: 'completed',
        player1_id: 'a1',
        player2_id: 'b2',
        winner_id: 'a1',
      },
      {
        round: 'semifinal',
        status: 'completed',
        player1_id: 'b1',
        player2_id: 'a2',
        winner_id: 'b1',
      },
      {
        round: 'final',
        status: 'completed',
        player1_id: 'a1',
        player2_id: 'b1',
        winner_id: 'b1',
      },
    ],
    ...overrides,
  };
}

describe('masterFinalOrder', () => {
  it('ordena campeón, finalista, semifinalistas y fase de grupos', () => {
    expect(masterFinalOrder(cuadro())).toEqual([
      'b1', // campeón
      'a1', // finalista
      'a2', // semifinalista con mejor récord (2-1, +2 sets)
      'b2', // semifinalista (2-1, +1 set)
      'a3', // 3ro de grupo con mejor récord (1-2, -1)
      'b3', // 3ro de grupo (1-2, -3)
      'b4', // 4to de grupo (0-3, -5)
      'a4', // 4to de grupo (0-3, -6)
    ]);
  });

  it('desempata dentro del escalón por diferencia de sets', () => {
    const c = cuadro();
    // b2 y a2 quedan con las mismas victorias: manda la diferencia de sets.
    const a2 = c.groups[0].players.find((p) => p.player_id === 'a2')!;
    a2.sets_won = 4;
    a2.sets_lost = 4; // diferencia 0 vs +1 de b2
    expect(masterFinalOrder(c).slice(2, 4)).toEqual(['b2', 'a2']);
  });

  it('no reordena nada si la final no se jugó', () => {
    const c = cuadro();
    c.matches = c.matches.map((m) =>
      m.round === 'final'
        ? { ...m, status: 'pending', winner_id: null }
        : m,
    );
    expect(isMasterFinished(c)).toBe(false);
    expect(masterFinalOrder(c)).toEqual([]);
  });

  it('deja abajo a los semifinalistas si las semis no se completaron', () => {
    const c = cuadro();
    c.matches = c.matches.filter((m) => m.round !== 'semifinal');
    // Sin semis registradas, solo el podio de la final sube.
    expect(masterFinalOrder(c).slice(0, 2)).toEqual(['b1', 'a1']);
  });
});

describe('applyMasterOrderToRange', () => {
  it('sube a los del cuadro al frente y conserva el resto en su orden', () => {
    const actual = ['x1', 'a1', 'x2', 'b1', 'x3'];
    expect(applyMasterOrderToRange(actual, ['b1', 'a1'])).toEqual([
      'b1',
      'a1',
      'x1',
      'x2',
      'x3',
    ]);
  });

  it('ignora a quien ya no está en el tramo', () => {
    // a1 terminó el semestre en otra categoría: no se lo trae de vuelta.
    expect(applyMasterOrderToRange(['x1', 'b1'], ['b1', 'a1'])).toEqual([
      'b1',
      'x1',
    ]);
  });

  it('sin cuadro terminado deja el tramo tal cual', () => {
    expect(applyMasterOrderToRange(['x1', 'x2'], [])).toEqual(['x1', 'x2']);
  });
});
