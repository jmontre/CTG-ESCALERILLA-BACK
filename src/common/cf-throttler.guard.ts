import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CfThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // En producción el tráfico entra por Cloudflare y CF-Connecting-IP es la IP
    // real del cliente (CF lo sobrescribe; no falsificable). Fuera de Cloudflare
    // —staging con dominio Railway directo, dev local— ese header lo puede setear
    // el propio cliente para evadir el rate limiting, así que se ignora
    // (BEHIND_CLOUDFLARE=false en staging) y se usa req.ip, que con
    // 'trust proxy' = 1 es la IP real del peer que llegó al edge de Railway.
    // No usar X-Forwarded-For manual: sus primeras entradas las controla el cliente.
    const behindCloudflare = process.env.BEHIND_CLOUDFLARE !== 'false';
    if (behindCloudflare) {
      const cfIp = req.headers?.['cf-connecting-ip'];
      if (cfIp) return Array.isArray(cfIp) ? cfIp[0] : cfIp;
    }
    return req.ip;
  }
}
