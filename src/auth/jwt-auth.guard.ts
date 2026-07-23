import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from './public.decorator';

/** Extrae el JWT de una request: header `Authorization: Bearer` o cookie `auth_token`. */
export function extractTokenFromRequest(request: any): string | undefined {
  const auth: string | undefined = request.headers?.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);

  // Fallback: cookie httpOnly — mismo dominio padre, SameSite=Lax
  const cookieHeader: string = request.headers?.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === 'auth_token') return part.slice(eqIdx + 1).trim();
  }
  return undefined;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = extractTokenFromRequest(request);
    if (!token) throw new UnauthorizedException('Token no proporcionado');
    try {
      request.user = this.jwtService.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
