import { Controller, Post, Body, Get, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Public } from './public.decorator';

// Frontend (reservas.clubdetenisgraneros.cl) y backend (api.clubdetenisgraneros.cl)
// comparten el dominio padre → SameSite=Lax alcanza, sin necesidad de SameSite=None.
// domain: '.clubdetenisgraneros.cl' hace la cookie accesible en todos los subdominios.
function setCookieToken(res: Response, token: string) {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    domain: '.clubdetenisgraneros.cl',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearCookieToken(res: Response) {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    domain: '.clubdetenisgraneros.cl',
    path: '/',
  });
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Throttle({ global: { limit: 3, ttl: 60_000 } })
  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // El token viaja solo en la cookie httpOnly, nunca en el body:
    // un XSS no puede leerlo y ningún cliente lo puede guardar mal.
    const { token, ...result } = await this.authService.register(dto);
    setCookieToken(res, token);
    return result;
  }

  @Throttle({ global: { limit: 5, ttl: 60_000 } })
  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, ...result } = await this.authService.login(dto);
    setCookieToken(res, token);
    return result;
  }

  // JwtAuthGuard ya verificó el token (header o cookie) y pobló req.user
  @Get('me')
  async me(@Req() req: Request & { user: { sub: string } }) {
    return this.authService.validateTokenByUserId(req.user.sub);
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    clearCookieToken(res);
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
