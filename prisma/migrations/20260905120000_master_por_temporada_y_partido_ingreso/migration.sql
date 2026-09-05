-- Master ligado a la temporada de escalerilla, y partido de ingreso.
--
-- 1. `master_seasons.season_id`: sin esto la página del Master devolvía siempre
--    el cuadro más reciente que existiera en la tabla, aunque fuera del
--    semestre anterior (el bug que se ve hoy: 2do semestre mostrando el Master
--    del 1ro).
-- 2. `challenges.type`: distingue el desafío normal del partido de ingreso.
-- 3. `players.entry_match_available`: quién tiene pendiente su partido de
--    ingreso (socio nuevo o reincorporado).
--
-- Idempotente: se puede reaplicar sobre una base que ya lo tenga.

ALTER TABLE "master_seasons" ADD COLUMN IF NOT EXISTS "season_id" TEXT;

DO $$
BEGIN
  ALTER TABLE "master_seasons"
    ADD CONSTRAINT "master_seasons_season_id_fkey"
    FOREIGN KEY ("season_id") REFERENCES "seasons"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "master_seasons_season_id_idx" ON "master_seasons"("season_id");

ALTER TABLE "challenges" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "players"    ADD COLUMN IF NOT EXISTS "entry_match_available" BOOLEAN NOT NULL DEFAULT false;

-- Los cuadros históricos se llamaron "1er Semestre 2026" y se jugaron dentro de
-- la temporada 2026-1. Se enganchan por nombre una sola vez; de acá en adelante
-- `generateMaster` graba el season_id solo.
UPDATE "master_seasons" ms
SET "season_id" = s."id"
FROM "seasons" s
WHERE ms."season_id" IS NULL
  AND s."slug" = '2026-1'
  AND ms."name" ILIKE '%1er Semestre 2026%';

-- Cualquier otro cuadro sin temporada queda enganchado a la temporada que
-- estaba abierta cuando se creó (o a la primera que empezó después).
UPDATE "master_seasons" ms
SET "season_id" = (
  SELECT s."id" FROM "seasons" s
  WHERE s."started_at" <= ms."created_at"
  ORDER BY s."started_at" DESC
  LIMIT 1
)
WHERE ms."season_id" IS NULL;
