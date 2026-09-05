-- La baja de un socio conserva su NOMBRE REAL en los partidos ya jugados.
--
-- La migración anterior lo renombraba a "Socio retirado", y eso dejaba el
-- historial del rival ilegible: el fixture mostraba "Socio retirado 6-1 6-2"
-- sin decir contra quién se jugó. El nombre se queda; lo que se limpia son los
-- datos de contacto y el acceso.
--
-- Con eso, "anonymized_at" pasó a describir algo que ya no ocurre: la columna
-- se llama "deactivated_at", que es lo que de verdad marca (cuenta dada de
-- baja, invisible en la app, viva en el historial).
--
-- Idempotente: no hace nada si la columna ya tiene el nombre nuevo.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'players' AND column_name = 'anonymized_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'players' AND column_name = 'deactivated_at'
  ) THEN
    ALTER TABLE "players" RENAME COLUMN "anonymized_at" TO "deactivated_at";
  END IF;
END $$;

ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "deactivated_at" TIMESTAMP(3);
