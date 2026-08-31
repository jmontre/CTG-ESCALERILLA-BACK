import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Cuerpo de POST /challenges.
 *
 * Los decoradores NO son decorativos: el ValidationPipe global corre con
 * `whitelist: true`, que elimina toda propiedad sin decorador de validación.
 * Sin ellos el campo llega como `undefined` al controller aunque el cliente lo
 * haya mandado, y el endpoint responde 400 siempre. (Ver CLAUDE.md, sección
 * "Validación de entrada".)
 */
export class CreateChallengeDto {
  @IsString()
  @IsNotEmpty({ message: 'challenged_id es requerido' })
  challenged_id: string;
}
