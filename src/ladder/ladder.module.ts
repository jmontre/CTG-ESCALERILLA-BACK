import { Global, Module } from '@nestjs/common';
import { LadderService } from './ladder.service';

/**
 * Global porque el orden de la escalerilla lo escriben varios módulos
 * (temporadas, jugadores, desafíos) y todos tienen que hacerlo por el mismo
 * lugar: dos implementaciones del corrimiento fue justo lo que dejó la
 * numeración con huecos.
 */
@Global()
@Module({
  providers: [LadderService],
  exports: [LadderService],
})
export class LadderModule {}
