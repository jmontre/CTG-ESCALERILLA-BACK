import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AppLogger {
  private readonly logger = new Logger('CTG');

  // ── Auth ──────────────────────────────────────────────────────────────────
  login(name: string, username: string) {
    this.logger.log(`🔐 LOGIN | ${name} (${username})`);
  }
  loginFailed(username: string) {
    this.logger.warn(`🔐 LOGIN FALLIDO | usuario: ${username}`);
  }
  register(name: string, username: string, email: string) {
    this.logger.log(`👤 NUEVO USUARIO | ${name} | ${username} | ${email}`);
  }
  passwordReset(name: string, phone: string) {
    this.logger.log(`🔑 RESET CONTRASEÑA | ${name} | ${phone}`);
  }

  // ── Reservas ──────────────────────────────────────────────────────────────
  reservationCreated(
    player: string,
    court: string,
    date: string,
    slot: string,
    isHighDemand: boolean,
    partner?: string,
    schoolName?: string,
  ) {
    const extra = schoolName
      ? ` | Escuela: ${schoolName}`
      : partner
        ? ` | Con: ${partner}`
        : '';
    const demand = isHighDemand ? ' 🔥' : '';
    this.logger.log(
      `📅 RESERVA | ${player} → ${court} | ${date} ${slot}${demand}${extra}`,
    );
  }
  reservationCancelled(
    player: string,
    court: string,
    date: string,
    slot: string,
    reason?: string,
  ) {
    const r = reason ? ` | Motivo: ${reason}` : '';
    this.logger.log(
      `🚫 CANCELACIÓN | ${player} → ${court} | ${date} ${slot}${r}`,
    );
  }
  reservationAdminCancelled(
    court: string,
    date: string,
    slot: string,
    reason?: string,
  ) {
    const r = reason ? ` | Motivo: ${reason}` : '';
    this.logger.log(`🚫 CANCELACIÓN ADMIN | ${court} | ${date} ${slot}${r}`);
  }
  reservationCompleted(count: number) {
    if (count > 0)
      this.logger.log(`✅ RESERVAS COMPLETADAS (cron) | ${count} reservas`);
  }

  // ── Bloqueos ──────────────────────────────────────────────────────────────
  courtBlocked(court: string, date: string, slots: string[], reason?: string) {
    const r = reason ? ` | Motivo: ${reason}` : '';
    this.logger.log(
      `🔒 BLOQUEO | ${court} | ${date} | Slots: ${slots.join(', ') || 'día completo'}${r}`,
    );
  }
  courtUnblocked(court: string, date: string) {
    this.logger.log(`🔓 DESBLOQUEO | ${court} | ${date}`);
  }

  // ── Desafíos ──────────────────────────────────────────────────────────────
  challengeCreated(
    challenger: string,
    challenged: string,
    pos1: number,
    pos2: number,
  ) {
    this.logger.log(
      `⚔️  DESAFÍO CREADO | ${challenger} (#${pos1}) → ${challenged} (#${pos2})`,
    );
  }
  challengeAccepted(challenger: string, challenged: string) {
    this.logger.log(
      `✅ DESAFÍO ACEPTADO | ${challenged} aceptó a ${challenger}`,
    );
  }
  challengeRejected(challenger: string, challenged: string) {
    this.logger.log(
      `❌ DESAFÍO RECHAZADO | ${challenged} rechazó a ${challenger} → W.O. para ${challenger}`,
    );
  }
  challengeScheduled(
    challenger: string,
    challenged: string,
    date: string,
    court?: string,
  ) {
    const c = court ? ` | ${court}` : '';
    this.logger.log(
      `📅 PARTIDO AGENDADO | ${challenger} vs ${challenged} | ${date}${c}`,
    );
  }
  challengeResult(
    winner: string,
    loser: string,
    score: string,
    newPos1: number,
    newPos2: number,
  ) {
    this.logger.log(
      `🏆 RESULTADO | ${winner} (#${newPos1}) venció a ${loser} (#${newPos2}) | ${score}`,
    );
  }
  challengeDisputed(
    challenger: string,
    challenged: string,
    score1: string,
    score2: string,
  ) {
    this.logger.warn(
      `⚠️  DISPUTA | ${challenger} dice: ${score1} | ${challenged} dice: ${score2}`,
    );
  }
  challengeAutoValidated(winner: string, loser: string, score: string) {
    this.logger.warn(
      `⏰ AUTO-VALIDADO | ${winner} venció a ${loser} | ${score} (sin doble confirmación)`,
    );
  }
  challengeExpiredNotAccepted(challenger: string, challenged: string) {
    this.logger.warn(
      `⏱️  EXPIRADO (no aceptado) | ${challenger} vs ${challenged} → W.O. para ${challenger}`,
    );
  }
  challengeExpiredNotPlayed(challenger: string, challenged: string) {
    this.logger.warn(
      `⏱️  EXPIRADO (no jugado) | ${challenger} vs ${challenged} → penalización`,
    );
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  whatsappSent(to: string, type: string) {
    this.logger.log(`📱 WSP → ${to} | ${type}`);
  }
  whatsappFailed(to: string, type: string, error: string) {
    this.logger.warn(`📱 WSP FALLÓ → ${to} | ${type} | ${error}`);
  }
  whatsappGroupSent(type: string) {
    this.logger.log(`📢 WSP GRUPO | ${type}`);
  }

  // ── Usuarios (admin) ──────────────────────────────────────────────────────
  playerCreated(name: string, memberType: string, adminRole?: string) {
    const role = adminRole ? ` | Rol: ${adminRole}` : '';
    this.logger.log(`👤 USUARIO CREADO | ${name} | ${memberType}${role}`);
  }
  playerUpdated(name: string, changes: string) {
    this.logger.log(`✏️  USUARIO ACTUALIZADO | ${name} | ${changes}`);
  }
  playerDeleted(name: string) {
    this.logger.warn(`🗑️  USUARIO ELIMINADO | ${name}`);
  }
  playerDeactivated(name: string, footprint: Record<string, number>) {
    const rastro = Object.entries(footprint)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}: ${n}`)
      .join(', ');
    this.logger.warn(`🚪 CUENTA DADA DE BAJA | ${name} | conserva ${rastro}`);
  }
  playerMoved(name: string, from: number, to: number) {
    this.logger.log(`↕️  MOVIMIENTO MANUAL | ${name} | #${from} → #${to}`);
  }
  ladderReordered(moved: number, total: number) {
    this.logger.log(
      `🔀 ESCALERILLA REORDENADA | ${moved} de ${total} jugadores cambiaron de puesto`,
    );
  }
  playerRetired(name: string, from: number, movedUp: number) {
    this.logger.log(
      `🚪 SALE DE LA ESCALERILLA | ${name} | era #${from} | ${movedUp} suben uno`,
    );
  }
  playerRejoined(name: string, position: number | null) {
    this.logger.log(
      `🔙 REINCORPORADO | ${name} | ${position ? `#${position}` : 'pendiente de partido de ingreso'}`,
    );
  }

  // ── Master ────────────────────────────────────────────────────────────────
  masterCreated(name: string, category: string) {
    this.logger.log(`🏆 MASTER CREADO | ${name} | ${category}`);
  }
  masterResult(winner: string, loser: string, score: string, round: string) {
    this.logger.log(
      `🏆 MASTER RESULTADO | ${round} | ${winner} vs ${loser} | ${score}`,
    );
  }

  // ── General ───────────────────────────────────────────────────────────────
  error(context: string, message: string, err?: any) {
    this.logger.error(`❌ ${context} | ${message}`, err?.message || err);
  }
}
