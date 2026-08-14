-- Planifie la purge fiable de card_price_history / value_history (Phase 3, cf roadmap technique) :
-- appelle chaque jour l'Edge Function purge-price-history (supabase/functions/purge-price-history)
-- via pg_cron + pg_net, plutôt que de dépendre du déclenchement client ad hoc (tracker.js:
-- purgeOldPriceHistory, seulement après login ou refresh manuel, jamais garanti si personne
-- ne se connecte). Rétention 35 jours conservée côté Edge Function (pas dupliquée ici).
--
-- Prérequis avant d'exécuter ce script :
--   1. Déployer l'Edge Function : `supabase functions deploy purge-price-history --project-ref <PROJECT_REF>`
--   2. Remplacer les deux valeurs <PROJECT_REF> et <ANON_PUBLIC_KEY> ci-dessous (Dashboard Supabase ->
--      Project Settings -> API) avant de lancer ce script dans l'éditeur SQL.
--
-- Comme les autres fichiers de sql/migrations/, ce script s'applique manuellement (pas de CI) —
-- copier/coller dans l'éditeur SQL Supabase.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Secrets stockés dans Vault plutôt qu'en clair dans la commande cron.schedule (visible par quiconque
-- lit pg_cron.job). do $$ ... $$ pour rester idempotent (ne pas dupliquer le secret si ce script est
-- relancé).
do $$
begin
    if not exists (select 1 from vault.decrypted_secrets where name = 'purge_price_history_url') then
        perform vault.create_secret(
            'https://<PROJECT_REF>.supabase.co/functions/v1/purge-price-history',
            'purge_price_history_url'
        );
    end if;

    if not exists (select 1 from vault.decrypted_secrets where name = 'purge_price_history_anon_key') then
        perform vault.create_secret('<ANON_PUBLIC_KEY>', 'purge_price_history_anon_key');
    end if;
end $$;

-- cron.schedule sur un jobname existant remplace sa planification/commande : relancer ce script après
-- avoir changé l'heure ci-dessous suffit, pas besoin d'unschedule d'abord.
select cron.schedule(
    'purge-price-history-daily',
    '17 3 * * *', -- 03:17 chaque jour (heure décalée pour éviter les pics de charge des jobs à l'heure pile)
    $$
    select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'purge_price_history_url'),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'purge_price_history_anon_key')
        )
    );
    $$
);

-- Rollback manuel si besoin :
-- select cron.unschedule('purge-price-history-daily');
-- delete from vault.secrets where name in ('purge_price_history_url', 'purge_price_history_anon_key');
