import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { extractTokenFromRequest } from './jwt-auth.guard';

/**
 * Guard "opcional": si hay un JWT válido, puebla `request.user`; si no hay token
 * o es inválido, deja pasar igual (nunca lanza). Sirve para endpoints @Public
 * que muestran datos extra solo a usuarios autenticados.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = extractTokenFromRequest(request);
    if (token) {
      try {
        request.user = this.jwtService.verify(token);
      } catch {
        // token inválido/expirado → se trata como anónimo
      }
    }
    return true;
  }
}
