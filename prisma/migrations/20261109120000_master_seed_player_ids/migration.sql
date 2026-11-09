-- Sembrado del cuadro Master congelado al generarlo.
--
-- Los grupos del round robin se armaban con la posición del momento en que
-- terminaba el playoff: si en esa semana alguien ganaba un desafío y entraba al
-- top 4, el round robin quedaba con otros clasificados directos que los ya
-- anunciados. Ahora el orden se guarda al generar.
--
-- Cuadros previos quedan con la lista vacía y siguen con el comportamiento
-- anterior. Idempotente.

ALTER TABLE "master_seasons" ADD COLUMN IF NOT EXISTS "seed_player_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
