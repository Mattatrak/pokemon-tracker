-- Phase 2 (suite) — expose cardmarket_id dans les surfaces publiques Collection/Wishlist.
-- cardmarket_id n'est pas une donnee sensible : simple identifiant produit Cardmarket, pas plus
-- privé que tcgdex_id (déjà exposé). Son absence forçait tous les liens Cardmarket des profils
-- publics à retomber sur une recherche par nom au lieu du lien produit exact.
-- Ne touche a aucune policy RLS, ne modifie aucune autre colonne exposee. cards/wishlist/wishlists
-- restent inaccessibles directement (SECURITY DEFINER inchange, meme condition profiles.is_public/
-- collection_visible|wishlist_visible qu'avant).

begin;

-- CREATE OR REPLACE ne peut pas changer le type de retour (nouvelle colonne cardmarket_id) : Postgres
-- exige un DROP explicite. Le DROP efface aussi les REVOKE/GRANT existants sur ces fonctions, donc
-- ils sont réappliqués juste après leur recréation (mêmes droits qu'avant, rien d'élargi).
drop function if exists public.get_cards_public(uuid);
drop function if exists public.get_wishlist_items_public(uuid);

create or replace function public.get_cards_public(p_user_id uuid)
returns table (
    user_id uuid,
    id bigint,
    tcgdex_id text,
    name text,
    number text,
    series text,
    series_logo text,
    series_symbol text,
    image text,
    rarity text,
    type text,
    illustrator text,
    condition text,
    finish text,
    quantity integer,
    market_value numeric,
    cardmarket_id text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select
        c.user_id,
        c.id,
        c.tcgdex_id,
        c.name,
        c.number,
        c.series,
        c.series_logo,
        c.series_symbol,
        c.image,
        c.rarity,
        c.type,
        c.illustrator,
        c.condition,
        c.finish,
        c.quantity,
        c.market_value,
        c.cardmarket_id
    from public.cards c
    join public.profiles p on p.id = c.user_id
    where c.user_id = p_user_id
      and p.is_public = true
      and p.collection_visible = true;
$$;

create or replace function public.get_wishlist_items_public(p_user_id uuid)
returns table (
    id bigint,
    user_id uuid,
    wishlist_id bigint,
    tcgdex_id text,
    name text,
    series text,
    image text,
    cardmarket_id text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select i.id, i.user_id, i.wishlist_id, i.tcgdex_id, i.name, i.series, i.image, i.cardmarket_id
    from public.wishlist i
    join public.profiles p on p.id = i.user_id
    where i.user_id = p_user_id
      and p.is_public = true
      and p.wishlist_visible = true;
$$;

-- Réappliqué explicitement (le DROP en tête de fichier a effacé les droits précédents) : mêmes
-- garanties que sql/migrations/2026-08-08_public_surfaces_phase2.sql — PUBLIC/anon exclus, seul
-- authenticated peut exécuter.
revoke all on function public.get_cards_public(uuid) from public, anon;
grant execute on function public.get_cards_public(uuid) to authenticated;

revoke all on function public.get_wishlist_items_public(uuid) from public, anon;
grant execute on function public.get_wishlist_items_public(uuid) to authenticated;

commit;

-- Rollback manuel si besoin : reappliquer la version precedente de ces deux fonctions
-- (sql/migrations/2026-08-08_public_surfaces_phase2.sql) via create or replace.
