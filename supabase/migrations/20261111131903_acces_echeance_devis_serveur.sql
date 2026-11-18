-- devis-secure appelle le relais public SECURITY INVOKER avec service_role.
-- EXECUTE existe déjà ; USAGE est nécessaire pour atteindre le helper privé.
-- Aucun droit supplémentaire accordé aux clients ou aux visiteurs.
grant usage on schema private to service_role;
