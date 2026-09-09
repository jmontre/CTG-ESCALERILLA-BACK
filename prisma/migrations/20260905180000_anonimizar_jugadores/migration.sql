-- Anonimización de socios en vez de borrado.
--
-- `DELETE /admin/players/:id` fallaba con 500 para cualquier jugador con
-- historial: borraba el `User` esperando cascada, pero `ranking_history`,
-- `challenges`, `master_matches` y `reservations` no tienen ON DELETE CASCADE
-- y la FK lo bloqueaba.
--
-- Borrar de verdad tampoco era la solución: los desafíos que jugó desaparecen
-- también del historial del rival y del fixture del club. Se anonimiza: el
-- socio deja de existir en la app, sus partidos siguen ahí como "Socio retirado".

ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "anonymized_at" TIMESTAMP(3);
