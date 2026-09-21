import { flipScore, scoreForPlayer } from './score-perspective';

describe('flipScore', () => {
  it('da vuelta cada set', () => {
    expect(flipScore('6-3, 6-1')).toBe('3-6, 1-6');
  });

  it('respeta los corchetes del super tiebreak', () => {
    expect(flipScore('7-6, 4-6, [10-7]')).toBe('6-7, 6-4, [7-10]');
  });

  it('conserva el sufijo de retiro', () => {
    expect(flipScore('6-4, 0-2 (Retiro)')).toBe('4-6, 2-0 (Retiro)');
  });

  it('deja igual un W.O. sin números', () => {
    expect(flipScore('W.O.')).toBe('W.O.');
  });

  it('sin marcador devuelve null', () => {
    expect(flipScore(null)).toBeNull();
    expect(flipScore('')).toBeNull();
  });

  it('darlo vuelta dos veces devuelve el original', () => {
    const original = '7-5, 3-6, [10-8]';
    expect(flipScore(flipScore(original))).toBe(original);
  });
});

describe('scoreForPlayer', () => {
  it('al ganador le muestra sus sets primero', () => {
    expect(
      scoreForPlayer('6-3, 6-1', { playerWon: true, playerIsChallenger: true }),
    ).toBe('6-3, 6-1');
  });

  it('al perdedor le da vuelta el mismo marcador', () => {
    expect(
      scoreForPlayer('6-3, 6-1', { playerWon: false, playerIsChallenger: false }),
    ).toBe('3-6, 1-6');
  });

  /**
   * Los 10 partidos resueltos desde el panel: el admin escribió el marcador
   * desde el ganador, que ahí era el DESAFIADO. Confiar en la convención del
   * desafiante los daba vuelta y el ganador veía su partido como perdido.
   */
  it('deduce la orientación del marcador, no del rol de desafiante', () => {
    // Pinilla (desafiado) le ganó a Pineda; guardado "6-3, 6-7, 10-4".
    expect(
      scoreForPlayer('6-3, 6-7, 10-4', {
        playerWon: true,
        playerIsChallenger: false,
      }),
    ).toBe('6-3, 6-7, 10-4');

    // Y al que perdió, ese mismo partido se le muestra al revés.
    expect(
      scoreForPlayer('6-3, 6-7, 10-4', {
        playerWon: false,
        playerIsChallenger: true,
      }),
    ).toBe('3-6, 7-6, 4-10');
  });

  it('en un retiro cae a la convención del desafiante', () => {
    // El marcador no sirve para deducir nada: el ganador puede ir abajo.
    expect(
      scoreForPlayer('1-6, 7-6 (Retiro)', {
        playerWon: true,
        playerIsChallenger: true,
      }),
    ).toBe('1-6, 7-6 (Retiro)');
    expect(
      scoreForPlayer('1-6, 7-6 (Retiro)', {
        playerWon: true,
        playerIsChallenger: false,
      }),
    ).toBe('6-1, 6-7 (Retiro)');
  });

  it('con sets parejos también cae a la convención del desafiante', () => {
    expect(
      scoreForPlayer('6-4, 3-6', { playerWon: true, playerIsChallenger: false }),
    ).toBe('4-6, 6-3');
  });

  it('sin marcador devuelve null', () => {
    expect(
      scoreForPlayer(null, { playerWon: true, playerIsChallenger: true }),
    ).toBeNull();
  });
});
