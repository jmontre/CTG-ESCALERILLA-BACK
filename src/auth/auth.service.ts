import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { whatsappService } from '../notifications/whatsapp.service';
import { AppLogger } from '../common/app.logger';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private appLogger: AppLogger,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email }] },
    });

    if (existingUser) throw new ConflictException('Username o email ya existe');

    const password_hash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: { username: dto.username, email: dto.email, password_hash },
    });

    // El registro público NO asigna posición automática en la escalerilla.
    // Un admin debe asignarla manualmente desde el panel de administración.
    // Esto evita que cuentas no verificadas contaminen el ranking del club.
    const player = await this.prisma.player.create({
      data: {
        user_id: user.id,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        position: null,
      },
    });

    const token = this.generateToken(user.id, user.is_admin, user.admin_role);
    this.appLogger.register(player.name, user.username, user.email);

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin,
        admin_role: user.admin_role,
      },
      player: {
        ...player,
        is_admin: user.is_admin,
        admin_role: user.admin_role,
      },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: { player: true },
    });

    if (!user) {
      this.appLogger.loginFailed(dto.username);
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.password_hash,
    );
    if (!isPasswordValid) {
      this.appLogger.loginFailed(dto.username);
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    // La baja es un soft delete: la contraseña sigue siendo válida a propósito,
    // para que restaurar la cuenta la devuelva entera. El bloqueo va acá.
    if (user.player?.deactivated_at) {
      this.appLogger.loginFailed(dto.username);
      throw new UnauthorizedException(
        'Esta cuenta está dada de baja. Habla con la comisión para reactivarla.',
      );
    }

    const token = this.generateToken(user.id, user.is_admin, user.admin_role);
    this.appLogger.login(user.player?.name || user.username, user.username);

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin,
        admin_role: user.admin_role,
      },
      player: {
        ...user.player,
        is_admin: user.is_admin,
        admin_role: user.admin_role,
      },
    };
  }

  async validateToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      return this.validateTokenByUserId(payload.sub);
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }

  async validateTokenByUserId(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { player: true },
    });
    if (!user) throw new UnauthorizedException('Usuario no encontrado');
    // Corta también las sesiones ya abiertas: el token sigue firmado pero deja
    // de resolver en cuanto se da de baja la cuenta.
    if (user.player?.deactivated_at)
      throw new UnauthorizedException('Esta cuenta está dada de baja');
    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin,
        admin_role: user.admin_role,
      },
      player: {
        ...user.player,
        is_admin: user.is_admin,
        admin_role: user.admin_role,
      },
    };
  }

  async forgotPassword(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { player: true },
    });

    const genericResponse = {
      message:
        'Si el usuario existe, se enviará un mensaje de WhatsApp con el enlace.',
    };

    if (!user || !user.player) return genericResponse;
    // No revelar que el usuario existe pero no tiene teléfono — anti-enumeración.
    if (!user.player.phone) return genericResponse;

    await this.prisma.passwordResetToken.updateMany({
      where: { user_id: user.id, used: false },
      data: { used: true },
    });

    const token = randomUUID();
    const expires_at = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: { user_id: user.id, token, expires_at },
    });

    const frontendUrl =
      process.env.FRONTEND_URL || 'https://escalerilla.clubdetenisgraneros.cl';
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    whatsappService
      .sendPasswordResetLink(user.player.name, user.player.phone, resetLink)
      .catch((err) => console.error('Error enviando WhatsApp reset:', err));

    const maskedPhone = user.player.phone.replace(
      /(\d{3})\d+(\d{3})$/,
      '$1****$2',
    );
    this.appLogger.passwordReset(user.player.name, maskedPhone);
    return genericResponse;
  }

  async resetPassword(token: string, newPassword: string) {
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetToken) throw new BadRequestException('El enlace no es válido.');
    if (resetToken.used)
      throw new BadRequestException('Este enlace ya fue utilizado.');
    if (new Date() > resetToken.expires_at)
      throw new BadRequestException(
        'El enlace ha expirado. Solicita uno nuevo.',
      );
    if (newPassword.length < 6)
      throw new BadRequestException(
        'La contraseña debe tener al menos 6 caracteres.',
      );

    const password_hash = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.user_id },
        data: { password_hash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { used: true },
      }),
    ]);

    return {
      message:
        'Contraseña actualizada correctamente. Ya puedes iniciar sesión.',
    };
  }

  private generateToken(
    userId: string,
    isAdmin: boolean,
    adminRole: string | null,
  ): string {
    const payload = { sub: userId, is_admin: isAdmin, admin_role: adminRole };
    return this.jwtService.sign(payload);
  }
}
