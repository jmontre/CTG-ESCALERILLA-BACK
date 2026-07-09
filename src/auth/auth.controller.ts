import { Controller, Post, Body, Get, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Public } from './public.decorator';

const CLUB_DOMAIN = '.clubdetenisgraneros.cl';

// Nunca usar SameSite=None: Safari iOS (ITP) y Samsung Internet tratan cookies
// cross-site como si no viajaran, así que un backend fuera de *.clubdetenisgraneros.cl
// (dev local, Railway/Vercel sin subdominio propio) queda sin sesión persistente hasta
// que tenga su propio subdominio bajo el dominio del club — comportamiento conocido y
// aceptado, no un bug a parchear con SameSite=None.
//
// - Host bajo *.clubdetenisgraneros.cl (prod, o staging con subdominio propio): la
//   cookie se comparte entre todos los subdominios (domain: '.clubdetenisgraneros.cl'),
//   y como frontend/backend están en el mismo dominio padre, SameSite=Lax alcanza.
// - Cualquier otro host: cookie host-only (sin domain) — sirve para local
//   (localhost:3000 API / localhost:3001 frontend son mismo site, Lax alcanza) y no
//   rompe nada en un host cross-site real, que de todos modos no puede recibir sesión.
export function getAuthCookieOptions(hostname: string | undefined) {
  const base = { httpOnly: true, secure: true, path: '/' } as const;
  if (hostname === CLUB_DOMAIN.slice(1) || hostname?.endsWith(CLUB_DOMAIN)) {
    return { ...base, sameSite: 'lax' as const, domain: CLUB_DOMAIN };
  }
  return { ...base, sameSite: 'lax' as const };
}

function setCookieToken(req: Request, res: Response, token: string) {
  res.cookie('auth_token', token, {
    ...getAuthCookieOptions(req.hostname),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearCookieToken(req: Request, res: Response) {
  res.clearCookie('auth_token', getAuthCookieOptions(req.hostname));
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Throttle({ global: { limit: 3, ttl: 60_000 } })
  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // El token viaja solo en la cookie httpOnly, nunca en el body:
    // un XSS no puede leerlo y ningún cliente lo puede guardar mal.
    const { token, ...result } = await this.authService.register(dto);
    setCookieToken(req, res, token);
    return result;
  }

  @Throttle({ global: { limit: 5, ttl: 60_000 } })
  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, ...result } = await this.authService.login(dto);
    setCookieToken(req, res, token);
    return result;
  }

  // JwtAuthGuard ya verificó el token (header o cookie) y pobló req.user
  @Get('me')
  async me(@Req() req: Request & { user: { sub: string } }) {
    return this.authService.validateTokenByUserId(req.user.sub);
  }

  @Public()
  @Post('logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    clearCookieToken(req, res);
    return { message: 'Sesión cerrada' };
  }

  @Throttle({ global: { limit: 3, ttl: 60_000 } })
  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body() body: { username: string }) {
    return this.authService.forgotPassword(body.username);
  }

  @Throttle({ global: { limit: 5, ttl: 60_000 } })
  @Public()
  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; password: string }) {
    return this.authService.resetPassword(body.token, body.password);
  }
}
