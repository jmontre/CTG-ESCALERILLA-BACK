import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Cuerpo de PATCH /master/matches/:id/replace-player.
 * Con `whitelist: true` un campo sin decorador llega como `undefined`.
 */
export class ReplacePlayoffPlayerDto {
  @IsString()
  @IsNotEmpty({ message: 'old_player_id es requerido' })
  old_player_id: string;

  @IsString()
  @IsNotEmpty({ message: 'new_player_id es requerido' })
  new_player_id: string;
}
