-- Planifie le rafraîchissement quotidien des prix marché pour TOUS les comptes (suite du chantier
-- Edge Functions, même pattern que 2026-08-14_schedule_price_history_purge.sql). Contourne la limite
-- de refreshAllMarketPrices (tracker.js), strictement mono-utilisateur par construction (RLS) - ce
-- job tourne côté serveur avec la clé service_role, indépendamment de toute activité utilisateur.
-- Même Edge Function que le bouton admin manuel (modules/admin.js#triggerGlobalPriceRefresh).
--
-- Edge Function déjà déployée (2026-09-04, --no-verify-jwt) : project-ref et clé anon ci-dessous déjà
-- renseignés (mmdcpkwygqsdaqnkimwb, clé anon publique par nature - identique à SUPABASE_ANON_KEY dans
-- tracker.js, déjà visible côté client de toute façon).
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
    if not exists (select 1 from vault.decrypted_secrets where name = 'refresh_market_prices_url') then
        perform vault.create_secret(
            'https://mmdcpkwygqsdaqnkimwb.supabase.co/functions/v1/refresh-market-prices',
            'refresh_market_prices_url'
        );
    end if;

    if not exists (select 1 from vault.decrypted_secrets where name = 'refresh_market_prices_anon_key') then
        perform vault.create_secret(
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tZGNwa3d5Z3FzZGFxbmtpbXdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTA2MTYsImV4cCI6MjA5OTg2NjYxNn0.mae_gw0VWy0ep8h9FrjJj2XSdjrfeR3mW9_Nx0nIaQ0',
            'refresh_market_prices_anon_key'
        );
    end if;
end $$;

-- Décalé de purge-price-history-daily (03:17) pour ne pas cumuler deux jobs lourds à la même minute -
-- cron.schedule sur un jobname existant remplace sa planification/commande : relancer ce script après
-- avoir changé l'heure ci-dessous suffit, pas besoin d'unschedule d'abord.
select cron.schedule(
    'refresh-market-prices-daily',
    '42 4 * * *', -- 04:42 chaque jour
    $$
    select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_market_prices_url'),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_market_prices_anon_key')
        )
    );
    $$
);

-- Rollback manuel si besoin :
-- select cron.unschedule('refresh-market-prices-daily');
-- delete from vault.secrets where name in ('refresh_market_prices_url', 'refresh_market_prices_anon_key');
