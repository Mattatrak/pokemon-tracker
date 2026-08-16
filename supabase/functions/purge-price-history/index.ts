// Purge fiable de l'historique de prix (Phase 3, premier chantier Edge Functions — cf roadmap technique).
// Remplace le déclenchement client (tracker.js:purgeOldPriceHistory, ad hoc après login/refresh manuel,
// jamais garanti si personne ne se connecte) par un job serveur, planifié via pg_cron
// (sql/migrations/2026-08-14_schedule_price_history_purge.sql) — tourne chaque jour, indépendamment de
// toute activité utilisateur.
//
// card_price_history est un cache de prix volontairement partagé entre comptes (pas de user_id, cf
// mémoire rls-migration-progress) : la purge globale est intentionnelle, pas un oubli d'isolation.
// value_history a un user_id + RLS ; on utilise la clé service_role pour purger tous les comptes en un
// seul passage plutôt que d'itérer utilisateur par utilisateur.
//
// Même fenêtre de rétention que l'ancien purge client (35 jours) : les stats/graphiques n'utilisent
// jamais plus de 30 jours d'historique, on garde une marge de 5 jours.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RETENTION_DAYS = 35;

Deno.serve(async (_req) => {
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [cardHistResult, valueHistResult] = await Promise.all([
        supabase.from('card_price_history').delete().lt('recorded_at', cutoff),
        supabase.from('value_history').delete().lt('recorded_at', cutoff),
    ]);

    if (cardHistResult.error || valueHistResult.error) {
        console.error('Erreur purge card_price_history:', cardHistResult.error);
        console.error('Erreur purge value_history:', valueHistResult.error);
        return new Response(
            JSON.stringify({
                ok: false,
                cardHistError: cardHistResult.error?.message ?? null,
                valueHistError: valueHistResult.error?.message ?? null,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    return new Response(
        JSON.stringify({ ok: true, cutoff }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
});
