import { ValidationPipe } from '@nestjs/common';
import { CreateChallengeDto } from './create-challenge.dto';

/**
 * Regresión: POST /challenges respondía 400 "challenged_id es requerido" aunque
 * el cliente sí mandaba el campo.
 *
 * La causa no era la validación sino el `whitelist: true` del ValidationPipe
 * global: elimina toda propiedad SIN decorador de validación. El DTO era una
 * clase sin decoradores, así que el pipe lo validaba (por ser clase) y de paso
 * lo dejaba vacío. El controller recibía `{}` y rechazaba.
 *
 * Lo que sigue es la prueba de que el campo SOBREVIVE al pipe, no solo de que
 * la validación acepta o rechaza — que es lo que no se estaba probando.
 */
describe('CreateChallengeDto — sobrevive al whitelist del pipe', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = { type: 'body' as const, metatype: CreateChallengeDto };

  it('conserva challenged_id después de pasar por el pipe', async () => {
    const salida = await pipe.transform(
      { challenged_id: '7e1a3c89-dc8e-4937-8cd4-a7f0a5ac3530' },
      meta,
    );
    // Sin decoradores esto sería `{}` y el endpoint respondería 400.
    expect(salida).toEqual({
      challenged_id: '7e1a3c89-dc8e-4937-8cd4-a7f0a5ac3530',
    });
  });

  it('rechaza si falta challenged_id', async () => {
    // Faltando el campo se disparan las dos reglas (@IsNotEmpty y @IsString);
    // basta con que el mensaje legible esté entre ellas.
    await expect(pipe.transform({}, meta)).rejects.toMatchObject({
      response: {
        message: expect.arrayContaining(['challenged_id es requerido']),
      },
    });
  });

  it('rechaza si viene vacío', async () => {
    await expect(pipe.transform({ challenged_id: '' }, meta)).rejects.toThrow();
  });

  it('descarta campos que el cliente no debería mandar', async () => {
    // El whitelist sí debe seguir limpiando lo que no está declarado: el
    // desafiante se toma del token, nunca del cuerpo.
    const salida = await pipe.transform(
      { challenged_id: 'abc', challenger_id: 'intento-de-suplantacion' },
      meta,
    );
    expect(salida).toEqual({ challenged_id: 'abc' });
  });
});
