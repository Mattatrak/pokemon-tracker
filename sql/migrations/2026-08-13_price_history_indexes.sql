-- Index sur card_price_history / value_history — validés par audit des requêtes réelles côté client
-- (cf audit technique du 2026-08-13), pas ajoutés par principe. Les deux tables ont des patterns
-- d'accès différents, donc des index différents :
--
-- card_price_history (pas de user_id, cache de prix volontairement partagé entre comptes) :
--   toujours filtrée par tcgdex_id (eq ou in) + triée/filtrée par recorded_at.
--     - card-detail.js:174-179   eq(tcgdex_id).order(recorded_at asc).limit(100)
--     - dashboard.js:624-629     in(tcgdex_id).lte(recorded_at).order(recorded_at desc)
--     - stats.js:49-55,196-202   in(tcgdex_id).gte(recorded_at).order(recorded_at desc).limit(20000)
--     - wishlist.js:56-60, public-profile.js:214-218   in(tcgdex_id).order(recorded_at desc)
--   -> index composite (tcgdex_id, recorded_at desc). La purge (tracker.js:823, delete().lt(recorded_at))
--      ne filtre pas par tcgdex_id et n'en profite pas, mais tourne rarement (une fois par
--      rafraîchissement de prix) : pas de second index dédié pour elle seule.
--
-- value_history (colonne user_id + RLS depuis la migration multi-utilisateur, jamais de tcgdex_id) :
--   jamais filtrée par carte, toujours implicitement scopée par user_id (RLS, y compris sur delete)
--   + triée par recorded_at.
--     - stats.js:99-103          order(recorded_at desc).limit(200)          [+ user_id implicite RLS]
--     - stats-render.js:756-760  order(recorded_at desc).limit(500)          [+ user_id implicite RLS]
--     - tracker.js:826           delete().lt(recorded_at, cutoff)            [+ user_id implicite RLS]
--   -> index composite (user_id, recorded_at desc). PAS (tcgdex_id, recorded_at) : cette colonne
--      n'existe pas sur cette table.
--
-- Les deux index sont DESC sur recorded_at (direction dominante dans les requêtes) ; un btree se
-- parcourt aussi bien en sens inverse, donc les rares tris ascendants (card-detail.js) restent servis
-- sans index séparé.

begin;

create index if not exists idx_card_price_history_tcgdex_recorded
    on public.card_price_history (tcgdex_id, recorded_at desc);

create index if not exists idx_value_history_user_recorded
    on public.value_history (user_id, recorded_at desc);

commit;

-- Rollback manuel si besoin :
-- begin;
-- drop index if exists public.idx_value_history_user_recorded;
-- drop index if exists public.idx_card_price_history_tcgdex_recorded;
-- commit;
