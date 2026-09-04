// Rafraîchissement des prix marché pour TOUS les comptes en un seul passage (suite du chantier Edge
// Functions, même pattern que purge-price-history) - refreshAllMarketPrices (tracker.js) est
// strictement mono-utilisateur par construction (RLS : ne lit/écrit que les cartes du compte
// connecté), donc personne n'a jamais de prix à jour tant qu'il ne clique pas lui-même sur
// "Rafraîchir". Ce job tourne côté serveur avec la clé service_role (contourne la RLS), pour toutes
// les cartes de tous les comptes.
//
// Deux déclencheurs :
//   - pg_cron (sql/migrations/2026-09-04_schedule_market_price_refresh.sql), 1x/jour - même cadence
//     que TCGdex lui-même (cf mémoire tcgdex_update_cadence, refresh plus fréquent inutile).
//     Authorization: clé anon, même convention que purge-price-history (URL jamais exposée côté
//     client, pas de garde supplémentaire sur ce chemin, cohérent avec l'existant).
//   - Bouton admin (modules/admin.js#triggerGlobalPriceRefresh, appelé via
//     supabaseClient.functions.invoke) - Authorization: JWT de l'utilisateur connecté, vérifié
//     ci-dessous contre admin_users avant d'exécuter quoi que ce soit.
//
// Portée volontairement identique à refreshAllMarketPrices côté client : met à jour cards.market_value
// + insère dans card_price_history (déjà partagé entre comptes, pas de user_id - cf commentaire de la
// migration d'origine). L'enrichissement avg1/avg7/avg30 et le calcul "Top hausses" du Dashboard
// restent un instantané local par appareil (localStorage), jamais dupliqués ici - portée délibérément
// restreinte pour rester simple.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const BATCH_SIZE = 5;
const API_BASE = 'https://api.tcgdex.net/v2/fr';
const API_EN = 'https://api.tcgdex.net/v2/en';

// CORS (appel navigateur direct depuis le bouton admin, contrairement à purge-price-history qui
// n'est jamais appelée que serveur-à-serveur par pg_cron, donc jamais concernée par une pré-requête
// OPTIONS) - déployée avec --no-verify-jwt (la vérification du JWT côté plateforme se ferait AVANT
// ce code et bloquerait l'OPTIONS avant même qu'il puisse recevoir ces en-têtes) : l'authentification
// reste entièrement gérée ici, explicitement, pour toute méthode autre que OPTIONS.
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    // Authentification : clé anon telle quelle (déclenchement pg_cron) ou JWT d'un utilisateur
    // réellement présent dans admin_users (bouton manuel) - rejette tout le reste.
    if (token !== anonKey) {
        const callerClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } }
        });
        const { data: userData, error: userError } = await callerClient.auth.getUser();
        if (userError || !userData?.user) {
            return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        const { data: isAdminRow } = await admin
            .from('admin_users')
            .select('user_id')
            .eq('user_id', userData.user.id)
            .maybeSingle();
        if (!isAdminRow) {
            return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }

    // Un tcgdex_id distinct par ligne, tous comptes confondus.
    const { data: idRows, error: idError } = await admin
        .from('cards')
        .select('tcgdex_id')
        .not('tcgdex_id', 'is', null)
        .neq('tcgdex_id', '');
    if (idError) {
        return new Response(JSON.stringify({ ok: false, error: idError.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    const uniqueIds = [...new Set((idRows ?? []).map((r) => r.tcgdex_id as string))];
    const priceMap: Record<string, number> = {};

    for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
        const batch = uniqueIds.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (id) => {
            try {
                let response = await fetch(`${API_BASE}/cards/${id}`);
                let data = await response.json();
                if (!data || data.status) {
                    const enResponse = await fetch(`${API_EN}/cards/${id}`);
                    data = await enResponse.json();
                }
                let price = 0;
                if (data?.pricing?.cardmarket?.avg) {
                    price = data.pricing.cardmarket.avg;
                } else if (data?.pricing?.cardmarket?.['avg-holo']) {
                    price = data.pricing.cardmarket['avg-holo'];
                }
                priceMap[id] = price;
            } catch (error) {
                console.error(`Erreur récupération prix pour ${id}:`, error);
            }
        }));
    }

    const idsWithPrice = Object.keys(priceMap);

    // Une requête UPDATE par tcgdex_id (touche toutes les lignes/tous comptes qui le partagent) plutôt
    // qu'un upsert en masse : market_value n'est pas la clé primaire, pas de contrainte unique
    // exploitable pour un upsert propre ici - même limite que côté client (tracker.js).
    const updateResults = await Promise.all(
        idsWithPrice.map((id) => admin.from('cards').update({ market_value: priceMap[id] }).eq('tcgdex_id', id))
    );
    const updateErrors = updateResults.filter((r) => r.error).map((r) => r.error?.message);

    if (idsWithPrice.length > 0) {
        const { error: historyError } = await admin
            .from('card_price_history')
            .insert(idsWithPrice.map((id) => ({ tcgdex_id: id, market_value: priceMap[id] })));
        if (historyError) console.error('Erreur historique prix (refresh global):', historyError);
    }

    return new Response(
        JSON.stringify({
            ok: updateErrors.length === 0,
            cardsChecked: uniqueIds.length,
            pricesFetched: idsWithPrice.length,
            updateErrors
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
});
