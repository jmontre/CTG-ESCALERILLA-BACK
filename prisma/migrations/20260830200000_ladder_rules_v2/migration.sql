-- Reglas nuevas de escalerilla: contadores de no-respuesta y de W.O. por
-- jugador, y esquema de categorías por temporada (se eliminó la categoría D).
-- Idempotente para poder aplicarse sobre bases que ya lo tengan.

ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "no_response_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "last_wo_win_at" TIMESTAMP(3);

ALTER TABLE "seasons" ADD COLUMN IF NOT EXISTS "category_scheme" TEXT NOT NULL DEFAULT 'v2';

-- El 1er semestre 2026 se jugó con 4 categorías sobre 48 puestos. Si ya está
-- cerrado, se marca con su esquema real para que el histórico no se reetiquete.
UPDATE "seasons" SET "category_scheme" = 'legacy4' WHERE "slug" = '2026-1';
