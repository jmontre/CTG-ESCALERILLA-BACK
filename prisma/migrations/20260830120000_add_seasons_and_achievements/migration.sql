-- Temporadas de la escalerilla + logros.
-- Idempotente (IF NOT EXISTS) para poder aplicarse sobre bases que ya lo tengan.

CREATE TABLE IF NOT EXISTS "seasons" (
    "id"         TEXT NOT NULL,
    "slug"       TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "status"     TEXT NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at"  TIMESTAMP(3),
    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "seasons_slug_key" ON "seasons"("slug");

CREATE TABLE IF NOT EXISTS "season_standings" (
    "id"             TEXT NOT NULL,
    "season_id"      TEXT NOT NULL,
    "player_id"      TEXT NOT NULL,
    "start_position" INTEGER,
    "final_position" INTEGER,
    "wins"           INTEGER NOT NULL DEFAULT 0,
    "losses"         INTEGER NOT NULL DEFAULT 0,
    "total_matches"  INTEGER NOT NULL DEFAULT 0,
    "category"       TEXT,
    "master_result"  TEXT,
    CONSTRAINT "season_standings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "season_standings_season_id_player_id_key" ON "season_standings"("season_id", "player_id");
CREATE INDEX IF NOT EXISTS "season_standings_player_id_idx" ON "season_standings"("player_id");

CREATE TABLE IF NOT EXISTS "player_achievements" (
    "id"          TEXT NOT NULL,
    "player_id"   TEXT NOT NULL,
    "code"        TEXT NOT NULL,
    "season_slug" TEXT NOT NULL DEFAULT 'global',
    "context"     JSONB,
    "unlocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen"        BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "player_achievements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "player_achievements_player_id_code_season_slug_key" ON "player_achievements"("player_id", "code", "season_slug");
CREATE INDEX IF NOT EXISTS "player_achievements_player_id_seen_idx" ON "player_achievements"("player_id", "seen");

ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "last_summary_seen" TEXT;

DO $$ BEGIN
  ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_season_id_fkey"
    FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "season_standings" ADD CONSTRAINT "season_standings_player_id_fkey"
    FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_player_id_fkey"
    FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
