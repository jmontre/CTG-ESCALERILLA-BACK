# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Resumen del Proyecto

Backend del **Club de Tenis Graneros (CTG)**. Gestiona la Escalerilla (ranking tipo ladder), desafíos entre jugadores, torneo Master, reservas de canchas (con cupos de alta demanda, cobro de luz y bloqueos), notificaciones WhatsApp/email y administración.

**Stack:** NestJS 11 + TypeScript + PostgreSQL + Prisma ORM 5
**Despliegue:** Railway (Postgres gestionado por Railway) — ver sección Despliegue
**Puerto:** 3000 (configurable vía `PORT`)

Existe también `ONBOARDING.md` (guía para colaboradores que vienen de PHP/WordPress). El `README.md` es el boilerplate de NestJS, sin información del proyecto.

---

## Comandos

```bash
npm run start:dev          # Desarrollo con watch mode
npm run build              # Compilar (usa --noEmitOnError false a propósito)
npm run start:prod         # Producción: node dist/main.js
npm run lint               # ESLint + auto-fix
npm run test               # Jest (tests en src/**/*.spec.ts)
npm run test:e2e           # Tests end-to-end
npx jest src/common/dates.spec.ts   # Un test específico

# Verificación de tipos REAL (el build ignora errores TS a propósito):
npx tsc -p tsconfig.build.json --noEmit

# Prisma
npx prisma generate        # Regenerar Prisma Client tras cambios en schema
npx prisma studio          # UI visual de la DB
npx prisma db seed         # Ejecutar seed (idempotente: admin/admin123)
# ⚠️ Antes de usar migrate dev, leer la sección "Schema y Migraciones"

# Scripts de utilidad (cargas masivas, fixes de posiciones/teléfonos)
npx ts-node scripts/<nombre>.ts
```

Archivos de entorno: `.env.dev` (dev) y `.env.production` (cuando `NODE_ENV=production`). Ver `src/app.module.ts`.

---

## Arquitectura

### Módulos NestJS

```
AppModule
├── ConfigModule (global, .env.production | .env.dev según NODE_ENV)
├── ScheduleModule (cron jobs)
├── PrismaModule (global, expone PrismaService)
├── CommonModule (global, expone AppLogger)
├── AuthModule (JWT 7 días)
├── PlayersModule (PlayersController + AdminPlayersController)
├── ChallengesModule (ChallengesController + AdminChallengesController)
├── CronModule (ChallengesCronService con 3 cron jobs)
├── LadderModule (global, expone LadderService: escrituras de posición)
├── MasterModule
├── SeasonsModule (ciclo de vida de la temporada + histórico)
├── AchievementsModule
├── NotificationsModule
└── ReservationsModule
```

`TestController` está registrado directamente en `AppModule` (sin módulo propio). Expone endpoints de prueba de WhatsApp (`POST /test/whatsapp`, `GET /test/grupos`, `POST /test/grupo`).

### Mapa de Endpoints (prefijos)

| Prefijo | Controller | Notas |
|---------|-----------|-------|
| `/auth` | register, login, me, forgot-password, reset-password | reset por WhatsApp |
| `/players` | lista pública (excluye admins), perfil propio (`PUT /me`), avatar | |
| `/admin/players` | CRUD jugadores, move, **reorder**, **retire/rejoin**, reset-immunity/vulnerability, weekly-usage | `DELETE` da de baja: anonimiza |
| `/challenges` | create, accept, reject, result, schedule, history, **entry** + **entry/targets** | |
| `/admin/challenges` | resolve, cancel, force delete, extend deadline, **entry-limit** (GET/POST) | |
| `/master` | `GET /?season=`, `GET /seasons`, `GET /:cat?season=`, generate, schedule, player-result, result (admin), check-final | todo lo público va por temporada |
| `/seasons` | periods, me/summary, `:slug`/standings, **next**, open, `:slug`/close, **rollover** (admin) | |
| `/reservations` | availability, courts, season, blocks, stats, light-config/summary, my, CRUD | |
| `/cron` | `POST /cron/run` (trigger manual) | |
| `/test` | pruebas WhatsApp | sin auth |

### Patrón Singleton para Servicios Externos

`whatsappService` y `emailService` son instancias exportadas a nivel de módulo, **no providers NestJS**:

```ts
// notifications/whatsapp.service.ts
export const whatsappService = new WhatsAppService();
// notifications/email.service.ts
export const emailService = new EmailService();
```

Se importan directamente. Es intencional: WhatsApp mantiene una sesión Puppeteer/Chromium persistente durante toda la vida del proceso (se inicializa en `main.ts` antes de `app.listen`).

### Autenticación: guards globales

Dos guards globales registrados como `APP_GUARD` en `AuthModule` (orden importa: JWT primero, Admin después):

- **`JwtAuthGuard`** (`src/auth/jwt-auth.guard.ts`): exige `Authorization: Bearer <token>` válido en toda ruta, salvo las marcadas con `@Public()` (`src/auth/public.decorator.ts`). Adjunta el payload a `request.user`. Rutas públicas: `POST /auth/{login,register,forgot-password,reset-password}` y `GET /` (health check).
- **`AdminGuard`** (`src/auth/admin.guard.ts`): exige `request.user.is_admin === true` en rutas marcadas con `@Admin()` (`src/auth/admin.decorator.ts`). Sin token → 401 (JwtAuthGuard corre primero); token de no-admin → 403. `@Admin()` se aplica a nivel de clase en `AdminPlayersController`, `AdminChallengesController`, `CronController`, `TestController`, y por handler en los endpoints admin de `ReservationsController` y `MasterController`.

El payload JWT contiene `{ sub: userId, is_admin: boolean, admin_role: string | null }`. `admin_role` ∈ `null | "escalerilla" | "reservas" | "all"`. **El guard solo distingue `is_admin`, no granularidad por `admin_role`** (pendiente fase 2).

La config de `JwtModule` está centralizada en `src/auth/jwt.config.ts` (`registerAsync` + `ConfigService`); **`JWT_SECRET` es obligatorio** (la app lanza error al arrancar si falta, sin fallback).

Varios controllers además derivan el `userId`/`player_id` del body o verifican el token manualmente (redundante con el guard, inofensivo). Pendiente fase 2: derivarlo siempre de `request.user`.

### Validación de entrada

`ValidationPipe` global (`whitelist: true, transform: true`) en `main.ts`. Los DTOs usan `class-validator` (`LoginDto`, `RegisterDto`, `CreateReservationDto`, `CreatePlayerDto`/`UpdatePlayerDto`). `whitelist: true` **elimina props no declaradas en el DTO** — al agregar un campo nuevo a un endpoint, declararlo en el DTO o se pierde silenciosamente. Varios handlers aún usan tipos inline (sin validar); se migran gradualmente.

### Logging

- `AppLogger` (`common/app.logger.ts`, global vía `CommonModule`): registra eventos de negocio (logins, desafíos, reservas, cambios de ranking) con formato emoji + pipe.
- `ChileLogger` (`common/chile-logger.ts`): extiende `ConsoleLogger` de Nest para timestamps en hora Chile; se pasa en `NestFactory.create` en `main.ts`.

---

## Fechas y Timezone (America/Santiago)

**Toda la lógica de fechas está centralizada en `src/common/dates.ts`** (con tests en `dates.spec.ts`). No reimplementar parsing de fechas inline; importar de ahí:

| Función | Uso |
|---------|-----|
| `nowInChile()` | Hora Chile como Date "naive" (reloj chileno almacenado como si fuera UTC). Solo para comparar con otros valores naive (ej: `date` + `time_slot` de reservas). **No** pasarla a `toChileDateStr()`. |
| `toChileDateStr(date)` | Timestamp UTC real → `YYYY-MM-DD` en Chile (usa locale `en-CA`). **No** usar con fechas naive. |
| `currentChileDate()` | Hoy en Chile como `YYYY-MM-DD`. |
| `chileWeekBoundsFromStr(str)` | Rango lunes-domingo a partir de un `YYYY-MM-DD`. Base del cupo semanal de alta demanda. |
| `monthBoundsUTC(year, month0)` | Inicio/fin de mes en UTC puro para queries sobre campos `@db.Date`. |

Conceptos clave:
- Los campos `@db.Date` de Prisma (ej: `Reservation.date`) se almacenan como **UTC midnight**. Para comparar contra "ahora", se reconstruye un Date naive (`date.toISOString().split('T')[0]` + `T${time_slot}:00`) y se compara con `nowInChile()`.
- Mezclar fechas naive con UTC reales es el bug clásico de este repo — leer los docstrings de `dates.ts` antes de tocar fechas.
- El servidor (Railway/Docker) corre en UTC; Chile es UTC-3/UTC-4 según horario de verano.

---

## Invariantes Críticos

### Posiciones en la Escalerilla

- `position = null` → jugador fuera de la escalerilla (sin ranking activo)
- `position = 0` → admins (excluidos de la lista pública vía filtro `is_admin` en `players.service.ts`)
- Posiciones son enteros únicos ≥ 1 para jugadores activos (unicidad por convención, **no** hay unique constraint en el schema — el corrimiento descendente y los `updateMany` con increment lo violarían transitoriamente; la protección la dan las transacciones)
- **Posición temporal 9999**: pivot al mover jugadores. El orden de updates importa (siempre descendente primero).

### Algoritmo de Corrimiento (`challenge-rules.service.ts` → `processWin`)

1. Si el ganador ya está adelante del perdedor → no hay cambios
2. Guardar `RankingHistory` de todos los afectados ANTES de mover
3. Mover ganador a posición 9999 (temporal)
4. Bajar afectados 1 posición (en orden descendente para evitar colisiones)
5. Colocar ganador en la posición del perdedor

Los pasos 2-5 corren dentro de un **`prisma.$transaction([...])`** (array ordenado): si algo falla, no queda la escalerilla a medio mover. Lo mismo aplica a `penalizeBothPlayers` (cron), `scheduleMatch` y `modify` (swap de reserva). `AdminChallengesService.resolveChallenge` delega en `processWin`/`applyPostMatchStatus`/`updateStats` (misma lógica que el flujo normal; antes tenía la suya propia).

### Transiciones de Estado Atómicas

Para transiciones de estado con riesgo de doble procesamiento (doble click, colisión con cron), usar el patrón claim con `updateMany` condicionado:

```ts
const claimed = await this.prisma.challenge.updateMany({
  where: { id, status: 'pending' },
  data:  { status: 'rejected', resolved_at: new Date() },
});
if (claimed.count === 0) throw new BadRequestException('Ya no está pendiente');
```

Implementado en `ChallengesService.reject` y `accept`, en las dos ramas de `processDoubleConfirmation` (resultado confirmado y disputa) y en los tres flujos del cron (`handleNotAccepted`, `handleNotPlayed`, `handleNotConfirmed`). **Toda transición que mueva posiciones o notifique va con claim**: sin él, dos requests que leyeron la fila antes de que cambiara el status corren el corrimiento, las stats y las notificaciones una vez cada una (pasó en producción: un resultado procesado 5 veces, con 5 tandas de WhatsApp). Tests: `challenges.result.spec.ts`.

---

## Reglas de Negocio: Escalerilla

### Sistema de Niveles (13 niveles, `getLevel` en challenge-rules.service.ts)

```
Nivel 1: pos 1          Nivel 6: pos 16-19      Nivel 11: pos 37-39
Nivel 2: pos 2-4        Nivel 7: pos 20-24      Nivel 12: pos 40-43
Nivel 3: pos 5-8        Nivel 8: pos 25-27      Nivel 13: pos 44-48
Nivel 4: pos 9-12       Nivel 9: pos 28-31
Nivel 5: pos 13-15      Nivel 10: pos 32-36
```

Un jugador puede desafiar: **su mismo nivel** (solo a quien esté adelante) O **1 nivel arriba**. Además: ninguno de los dos puede estar "ocupado" (desafío pending/accepted), el desafiado no puede estar inmune, el desafiante no puede estar vulnerable.

### Estados de un Desafío

```
pending → accepted → completed
                  → disputed (resultados no coinciden, admin resuelve)
pending → rejected (challenger gana W.O.)
pending → expired_not_accepted (cron, 24h sin respuesta, challenger gana W.O.)
accepted → expired_not_played (cron, 5 días sin jugar, se penaliza al challenger)
(admin) → cancelled
```

Plazos: `accept_deadline` = creación + 24h; `play_deadline` = creación + 5 días.

### Doble Confirmación de Resultados

- Si un jugador envía resultado y el otro no en **4 horas** (`HOURS_TO_CONFIRM_RESULT` en el cron), se auto-valida el existente (referencia: `first_result_at ?? accepted_at`, marca `results_match: false`).
- Ambos coinciden → procesa automáticamente (`results_match: true`).
- Difieren → `disputed`, requiere admin (`POST /admin/challenges/:id/resolve`).

### Penalización por No Jugar (`expired_not_played`)

Solo se penaliza al **challenger** (baja 1 posición; el de abajo sube 1). No es W.O.

### Post-Partido

- Ganador: inmune 24h (excepto si queda en posición #1)
- Perdedor: vulnerable 24h — puede **recibir** desafíos pero no **crear**

### Fijar Fecha de Desafío (`scheduleMatch`)

Crea una **reserva automática** (`is_challenge: true`, `challenge_id`) que: valida cancha/slot libre, valida que el jugador no tenga otra reserva activa (el filtro usa `OR` explícito porque `NOT` sobre campo nullable excluye `NULL` en SQL — ver comentario en código), descuenta cupo de alta demanda, y cancela la reserva anterior del mismo desafío al reprogramar. Al completarse el partido o cancelar la reserva, se libera/desvincula (`scheduled_date: null`).

---

## Reglas de Negocio: Reservas

### Horarios

Slots del día (90 min c/u): `06:00, 07:45, 09:30, 11:15, 13:00, 14:45, 16:30, 18:15, 20:00, 21:45`. El cron completa reservas 90 minutos después del inicio.

### Slots de Alta Demanda — definidos en DOS lugares (mantener sincronizados)

- `src/challenges/challenges.service.ts` → constante `HIGH_DEMAND`
- `src/reservations/reservations.service.ts` → constante `HIGH_DEMAND_SLOTS`

```ts
{ verano: ['07:45', '09:30', '18:15', '20:00'],
  invierno: ['09:30', '11:15', '16:30', '18:15'] }
```

La temporada activa se lee de `SystemConfig` key `"season"` (`"verano"` | `"invierno"`, default `"verano"`).

### Límites por tipo de socio (`member_type`)

| Tipo | Alta demanda/semana | Reservas activas | Otras reglas |
|------|--------------------|------------------|--------------|
| `socio` | 2 + nº hijos + `extra_high_demand_slots` (cupo familiar) | 1 | puede traer visita ($3.000 default `guest_fee`) |
| `hijo_socio` | 1 (contador individual, además del familiar) | 1 | |
| `profe` | sin límite | sin límite | usa `school_name` (de `Player.school_names`), sin visita, sin notificación WhatsApp |

- `has_debt: true` → no puede crear reservas.
- **Cancelación tardía** (< 4.5 horas = 3 turnos antes): se permite, pero el turno cuenta como usado. Se detecta por el string exacto `cancel_reason = 'Cancelación tardía - turno descontado'` (las queries de cupo filtran por ese literal — no cambiarlo).
- **Semana = lunes-domingo Chile** (`chileWeekBoundsFromStr`). El reset del lunes no actualiza nada en DB: el límite se recalcula dinámicamente contra el rango de la semana.
- **Modificar reserva** (`PATCH /reservations/:id/modify`): cancela la antigua (`cancel_reason: 'Modificada por jugador'`, no cuenta como tardía), crea la nueva, y si falla **restaura la antigua** (rollback manual).

### Bloqueos y Cobro de Luz

- `CourtBlock`: bloqueos admin por cancha/fecha; `time_slot = null` bloquea el día completo.
- `LightChargeConfig`: por fecha, define slots con cobro de luz y monto (`amount_per_slot`, default $3.000). `GET /reservations/light-summary?month=YYYY-MM` calcula recaudación (excluye desafíos).

---

## Reglas de Negocio: Torneo Master

Los rangos de categoría salen de `common/ladder.ts` según el `category_scheme` de la temporada (`v2`: A 1-14, B 15-28, C 29+; `legacy4`: los 4 rangos de 12 hasta el 1er semestre 2026). Del rango se toman 14 cupos: los 4 primeros clasifican directo al round robin, del 5° al 12° juegan un playoff a partido único por los 4 restantes, y del 13° en adelante quedan fuera. Los 8 resultantes se reparten en Grupo A / Grupo B.

**Cada cuadro pertenece a una temporada** (`master_seasons.season_id`). `generateMaster` lo engancha con la temporada abierta y deriva el nombre de ella: antes el nombre se escribía a mano y el cierre no encontraba los cuadros. Los endpoints públicos responden siempre por temporada — sin `?season=` responden la abierta, que puede no tener cuadro todavía (y ahí la página avisa "aún no disponible" en vez de mostrar el del semestre pasado, que era el bug de septiembre 2026).

Flujo automático: round robin → semifinales (al completar todos los partidos de grupo; cruces 1A-2B / 1B-2A) → final (al completar ambas semis). Estados de season: `pending → active → semifinals → final → completed`.

**Doble confirmación de resultados**: `submitPlayerResult` (jugador) guarda en `master_matches.player1_result`/`player2_result` (Json). Si ambos coinciden → procesa; si difieren → `disputed`; el admin resuelve con `POST /master/matches/:id/result`. (Estos campos y la migración correspondiente existen desde el saneamiento de junio 2026 — antes el flujo de jugador estaba roto.)

---

## Temporadas: cierre, reordenamiento y bajas

Una temporada es un semestre (`seasons`, slug `AÑO-SEMESTRE`). El histórico congelado vive en `season_standings`, así que la escalerilla se puede reordenar entera sin perder lo que pasó antes.

**`POST /seasons/rollover`** hace el cambio completo en un paso (`SeasonsService.rollover`), en este orden — el orden importa:

1. **Cierra** la temporada abierta. Primero reordena (`reorderByMaster`), después congela: si se congelara antes, el resumen del jugador diría un puesto y la escalerilla mostraría otro.
2. **Baja** a los jugadores marcados (después del cierre, para que el histórico del semestre los incluya).
3. **Abre** la siguiente, con slug y nombre derivados (`common/season-naming.ts`: `2026-1 → 2026-2 → 2027-1`), y congela la posición inicial de todos.

**Reordenamiento por Master** (`reorderByMaster` + `master/master-order.ts`): los 8 del round robin pasan a los 8 primeros puestos de su categoría, en el orden campeón → finalista → semifinalistas perdedores → fase de grupos, desempatando dentro de cada escalón por récord de grupo (victorias, diferencia de sets, sets ganados). Del 9 hacia abajo la categoría no se toca. Reglas duras:
- Se reordena **dentro del tramo de cada categoría**: nadie cruza de categoría por el reordenamiento.
- Un cuadro sin final jugada **no reordena nada** (`isMasterFinished`); la respuesta informa qué categorías se saltaron.
- Se usa el `category_scheme` de la temporada que cierra, no el vigente.

**Bajas y reincorporaciones** (`POST /admin/players/:id/retire|rejoin`): salir de la escalerilla es `position = null` **más el corrimiento de los de abajo**. Todos los datos del jugador se conservan (récord, historial, logros, temporadas). Al reincorporar, sin `position` se le habilita el partido de ingreso; con `position` el admin lo ubica directo.

⚠️ **Toda escritura de posición que no venga de un resultado va por `LadderService`** (`src/ladder/`): `retire`, `insertAt`, `sendToBottom`, `applyOrder`. Ponerlas a mano fue lo que dejó la numeración con huecos (1,2,4,5) y con eso los niveles de la pirámide corridos. Los movimientos por resultado de partido siguen en `ChallengeRulesService`.

**`POST /admin/players/reorder`** guarda el orden completo que el admin armó arrastrando en el panel (`LadderEditor` en el frontend). Exige la lista **exacta** de los que hoy están en la escalerilla: si falta alguien o sobra alguien —otro admin movió a un jugador, o se resolvió un desafío mientras editaba— se rechaza con 409 nombrando a los que faltan, en vez de pisar ese cambio.

---

## Partido de Ingreso

Quien entra al club sin puesto o vuelve a la escalerilla juega **un** partido para ganarse su lugar: elige rival del tope hacia abajo, si gana entra en el puesto del rival (que baja uno, junto con todos los de abajo) y si pierde entra último de toda la escalerilla. Gane o pierda, el derecho se gasta.

- `challenges.type = 'entry'` lo distingue del desafío normal; `players.entry_match_available` marca a quién le corresponde. Se enciende al crear un socio sin puesto (`AdminPlayersService.createPlayer`) y al reincorporar; se apaga al resolverse el partido o si el admin le asigna un puesto a mano.
- **Tope configurable**: `system_config.entry_match_top_limit` (default 15). No puede apuntar más arriba de ese puesto.
- No corren las reglas normales de escalerilla (fila de la pirámide, vulnerabilidad, espera entre revanchas): el ingresante todavía no tiene puesto. Sí corren "ocupado" e inmunidad del rival.
- **Rechazo y vencimiento de plazo los gana el ingresante por W.O.**, igual que un desafío normal (incluido `expired_not_played`, donde la penalización habitual al challenger no aplica: no tiene puesto que bajar).
- La regla vive en un solo lugar: `ChallengeRulesService.handleIfEntryMatch` intercepta al principio de `processWin` y `processDecline`, y el cron la llama antes de `penalizeBothPlayers`. Tests en `challenges/entry-match.spec.ts` y `ladder/ladder.service.spec.ts`.

---

## Schema y Migraciones

El drift histórico fue saneado en junio 2026. **Todas las migraciones están versionadas** (`prisma/migrations/`, ya no en `.gitignore`) y reconstruyen la DB correctamente con `migrate deploy`:
- `20260611100000_sync_schema_drift`: migración **idempotente** que registra todo lo creado históricamente con `db push` (tablas `courts`, `reservations`, `system_config`, `court_blocks`, las 4 del Master; columnas `extra_high_demand_slots`, `school_names`, `partner_name`, `is_challenge`, etc.). En una DB existente es no-op (guardas `IF NOT EXISTS` / `DO ... EXCEPTION WHEN duplicate_object`).
- `20260611100002_add_performance_indexes`: índices de consulta + el único índice schema-vs-DB que **no** está en `schema.prisma`.
- `20260905120000_master_por_temporada_y_partido_ingreso`: `master_seasons.season_id` (con backfill de los cuadros históricos a `2026-1`), `challenges.type` y `players.entry_match_available`. Idempotente.

**Única excepción schema ↔ DB**: el índice único PARCIAL `reservations_active_slot_uniq` (`court_id, date, time_slot` WHERE `status = 'active'`) — Prisma no soporta índices parciales, así que vive solo en SQL. `migrate dev` lo reportará como drift esperado; **no eliminarlo**. Es la protección anti doble-booking: el código captura su violación (Prisma `P2002`) y la traduce a `BadRequestException`. Pre-deploy: si pudieran existir duplicados activos, verificar antes (comentario en la migración).

`npx prisma generate` mantiene el client al día. **No usar `(this.prisma as any)`** — todos los modelos/campos están tipados. (El `build` aún usa `--noEmitOnError false` por inercia; el código compila limpio con `npx tsc -p tsconfig.build.json --noEmit`.)

---

## Variables de Entorno

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | **Obligatoria.** Connection string del Postgres de Railway. Es conexión directa (Railway Postgres no tiene pooler), así que la usa también `migrate deploy`. En prod usa el host interno `postgres.railway.internal`; en dev, el proxy público `*.proxy.rlwy.net`. |
| `JWT_SECRET` | **Obligatoria.** Secreto JWT (7 días). La app lanza error al arrancar si falta (sin fallback). |
| `RESEND_API_KEY` | API key de Resend.com (emails desde `escalerilla@clubdetenisgraneros.cl`) |
| `FRONTEND_URL` | URL del frontend (CORS + links en notificaciones) |
| `WHATSAPP_ENABLED` | `"true"` para activar WhatsApp (requiere Chromium) |
| `WHATSAPP_GROUP_ID` | ID del grupo de WhatsApp (obtener via `GET /test/grupos`) |
| `WHATSAPP_SESSION_PATH` | Path para la sesión (default: `.wwebjs_auth`) |
| `PUPPETEER_EXECUTABLE_PATH` | Path a Chromium (en Docker: `/usr/bin/chromium`) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Cloudinary |
| `PORT` | Puerto (default: 3000) |

---

## Despliegue

**Railway con Dockerfile** (`node:20-slim` + Chromium via apt). CMD: `npx prisma migrate deploy && node dist/main.js` — aplica migraciones en cada arranque. Ya no hay `railway.json`/`nixpacks.toml`/`Procfile` (definían un `startCommand` que **anulaba el CMD del Dockerfile** y por eso las migraciones no corrían desde marzo 2026; eliminados).

- **El "Custom Start Command" de Railway → Settings → Deploy debe quedar VACÍO**, o volvería a anular el CMD del Dockerfile.
- `DATABASE_URL` debe apuntar al Postgres de Railway. No se usa `DIRECT_URL`: el `datasource` del schema solo declara `url` (Railway Postgres es conexión directa, sin pooler). Antes el schema declaraba `directUrl = env("DIRECT_URL")` con esa variable sin definir → `migrate deploy` fallaba con `P1012`; se eliminó.

**Base de datos**: Postgres gestionado por Railway (servicio Postgres del mismo proyecto), no Supabase.

**CORS** (`main.ts`): permite `localhost:3000/3001`, `reservas.` y `escalerilla.clubdetenisgraneros.cl`, `FRONTEND_URL`, requests sin origin, y cualquier `*.vercel.app` (previews).

---

## Cron Jobs (`cron/challenges-cron.service.ts`)

| Job | Schedule | Qué hace |
|-----|----------|----------|
| `handleExpiredChallenges` | `0 0,6,12,18 * * *` | Expira no aceptados (W.O.), penaliza no jugados, auto-valida resultado único (4h) |
| `handleExpiredReservations` | `0 * * * *` | Marca como `completed` reservas cuyo fin (inicio + 90 min) ya pasó en hora Chile |
| `handleWeeklyHighDemandReset` | `0 0 * * 1` | Solo loguea el reset (el reset es implícito por el rango de fechas de la query) |

Trigger manual: `POST /cron/run` (ejecuta los dos primeros).

---

## Notificaciones

**WhatsApp** (whatsapp-web.js + Puppeteer):
- Formato de números chilenos: `569XXXXXXXX@c.us` (el servicio agrega `56` automáticamente)
- **No bloquean el request**: los services (`challenges`, `reservations`, `master`) envían vía un helper `notifyAsync(task)` fire-and-forget (`void task().catch(...)`). El cálculo del `return` y las mutaciones de estado quedan SIEMPRE fuera del `notifyAsync`.
- `sendGroupMessage(groupId, msg)` → grupo del club; `sleep(500-600ms)` entre mensajes para evitar ban
- Al iniciar limpia locks de Chromium (`SingletonLock`, etc.) de la sesión

**Email** (Resend): solo para notificaciones de desafío creado/aceptado; el reset de contraseña va por WhatsApp.

---

## Avatares (Cloudinary)

- Carpeta `ctg-avatars/`, public ID `player-{playerId}` (overwrite al subir)
- Transformación: 400x400, crop face, quality auto. Input: base64 (límite 10MB en bodyParser, configurado en `main.ts`)

---

## Seed

`npx prisma db seed` crea (vía `upsert`, idempotente) usuario `admin` / `admin123` / `admin@ctg.cl` con `is_admin: true` y player con `position = 0` (excluido de la lista pública). Correrlo de nuevo no falla.

---

## Gotchas Importantes

- **`ChallengeRulesService`** se provee en `ChallengesModule` Y en `PlayersModule` (instanciado en ambos para evitar circular deps).
- **`admin-players.service.ts` (`movePlayer`)** usa su propia lógica de movimiento de posiciones con `updateMany` increment/decrement (no delega a `ChallengeRulesService`) — verificar consistencia al modificar. (`admin-challenges.service.ts resolveChallenge` SÍ delega desde junio 2026.)
- **`cancelChallenge` admin** revierte wins/losses pero **NO revierte** cambios de ranking (documentado en su respuesta; decisión de negocio).
- **Cancelaciones tardías**: se discriminan por el string literal `'Cancelación tardía - turno descontado'` en queries de cupo (reservations.service y admin-players). No cambiarlo sin actualizar ambos.
- **`DELETE /admin/players/:id` no borra: es un soft delete.** Lo único que escribe es `deactivated_at` (y apaga `entry_match_available`), más la salida de la escalerilla compactando puestos. **No toca ni un dato** — nombre, email, teléfono, avatar, username, contraseña, récord y notificaciones quedan intactos — para que `POST /admin/players/:id/restore` devuelva la cuenta entera el día que el socio vuelve. Borrar de verdad se llevaría los desafíos del historial del RIVAL y descuadraría el fixture; además la FK lo bloqueaba y el endpoint devolvía 500.
- **`deactivated_at` es lo que oculta al jugador**: `AuthService.login` y `validateTokenByUserId` lo rechazan (esto último corta también las sesiones ya abiertas), y los listados lo filtran. **Al agregar un listado de jugadores nuevo, filtrar `deactivated_at: null`.** La única vista que los muestra es `GET /admin/players/deactivated`.
- **El `name` no se toca nunca**, a propósito: es lo que hace que el fixture y el historial del rival sigan diciendo contra quién se jugó. Se probó renombrando a "Socio retirado" y dejaba los partidos ilegibles.
- **`DELETE /admin/players/:id/purge`** es el único borrado real, y solo para cuentas **ya dadas de baja y sin ningún rastro** (la creada por error). Con un solo partido jugado se niega, porque ese partido también es del rival.
- Como `email` y `username` siguen ocupados, crear un jugador con los mismos datos devuelve un 409 que nombra la cuenta dada de baja y sugiere restaurarla, en vez del genérico "ya existe".
- Para el socio que solo deja de jugar el semestre, la operación correcta sigue siendo `retire` (sale de la escalerilla, conserva todo y puede volver), no la baja de cuenta.
- **Posición al registrar**: `AuthService.register` (público) asigna `lastPlayer.position + 1` automáticamente. `AdminPlayersService.createPlayer` deja `position = null` si no se especifica.
- **Pendiente fase 2** (documentado en el spec de junio 2026): granularidad de permisos por `admin_role`; cerrar/moderar el registro público; derivar `player_id` del token en vez del body; migrar de whatsapp-web.js a WhatsApp Business API; soporte multi-instancia (hoy **requiere 1 réplica** en Railway por crons y sesión WhatsApp); paginación de listados y N+1.
