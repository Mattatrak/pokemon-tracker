-- Phase 2 — Surfaces de lecture publique
-- Audit préalable confirmé (voir historique du ticket) :
--   1. PostgreSQL 17.6 -> security_invoker disponible (nécessite PG >= 15)
--   2. relforcerowsecurity = false sur profiles/cards/wishlist/wishlists -> RLS non forcée,
--      le propriétaire des tables reste exempté de RLS comme attendu
--   3. Propriétaire des 4 tables = postgres, rolbypassrls = true -> les fonctions
--      SECURITY DEFINER ci-dessous bypassent bien la RLS de cards/wishlist/wishlists comme conçu
--
-- Ne modifie AUCUNE policy existante de cards / wishlist / wishlists (contrainte explicite).
-- profiles : une policy SELECT supplémentaire est ajoutée (autorisé, non exclu de la contrainte),
-- le reste (insert own profile / select own profile / update own profile) reste inchangé.

begin;

-- =====================================================================================
-- 1. PROFILES — RLS réelle (pas de bypass ici : profiles ne contient aucune colonne sensible)
-- =====================================================================================

create policy "select public profiles"
    on public.profiles
    for select
    using (is_public = true);
-- Combinée en OR avec "select own profile" existante (auth.uid()=id) : PERMISSIVE par défaut,
-- donc un utilisateur voit toujours ses propres données ET les profils publics des autres.

create view public.profiles_public
    with (security_invoker = true) as
select
    id,
    username,
    pseudo,
    avatar_url,
    created_at,
    is_public,
    collection_visible,
    wishlist_visible
from public.profiles;
-- security_invoker = true : la vue s'exécute avec les droits ET la RLS de l'appelant, pas du
-- créateur de la vue. Sans ce réglage (comportement par défaut avant PG15 ou si omis), la vue
-- s'exécuterait avec les droits du propriétaire et court-circuiterait silencieusement la RLS de
-- "profiles" — c'est précisément le bypass à éviter, d'où l'obligation de vérifier le §5 avant tout.

revoke all on public.profiles_public from public, anon;
grant select on public.profiles_public to authenticated;

-- =====================================================================================
-- 2. CARDS_PUBLIC — fonction SECURITY DEFINER strictement verrouillée
--    Nécessaire uniquement parce que la RLS de "cards" reste owner-only (contrainte : ne pas la
--    toucher) : security_invoker serait un no-op ici (RLS de la table appelée bloquerait quand
--    même tout accès cross-user). Cette fonction réimplique manuellement la condition
--    qu'une policy RLS aurait portée (profil public + collection_visible), rien de plus.
-- =====================================================================================

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
    market_value numeric
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
        c.market_value
    from public.cards c
    join public.profiles p on p.id = c.user_id
    where c.user_id = p_user_id
      and p.is_public = true
      and p.collection_visible = true;
$$;
-- Verrouillage :
--  - search_path figé (public, pg_temp) : empêche un rôle malveillant de placer une fonction/table
--    homonyme plus tôt dans un search_path modifiable pour détourner l'exécution.
--  - stable (pas volatile) : déclare l'absence d'écriture, aucune modification possible ici de toute
--    façon (select seul dans le corps).
--  - paramètre unique p_user_id uuid : pas de SQL dynamique, pas d'injection possible.
--  - la condition p.is_public/collection_visible est réévaluée à CHAQUE appel (pas mise en cache),
--    donc un retrait de visibilité par le propriétaire prend effet immédiatement.

revoke all on function public.get_cards_public(uuid) from public, anon;
grant execute on function public.get_cards_public(uuid) to authenticated;

-- =====================================================================================
-- 3. WISHLISTS_PUBLIC / WISHLIST_PUBLIC — même schéma, condition wishlist_visible
-- =====================================================================================

create or replace function public.get_wishlists_public(p_user_id uuid)
returns table (
    id bigint,
    user_id uuid,
    name text,
    icon text,
    color text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select w.id, w.user_id, w.name, w.icon, w.color
    from public.wishlists w
    join public.profiles p on p.id = w.user_id
    where w.user_id = p_user_id
      and p.is_public = true
      and p.wishlist_visible = true;
$$;

revoke all on function public.get_wishlists_public(uuid) from public, anon;
grant execute on function public.get_wishlists_public(uuid) to authenticated;

create or replace function public.get_wishlist_items_public(p_user_id uuid)
returns table (
    id bigint,
    user_id uuid,
    wishlist_id bigint,
    tcgdex_id text,
    name text,
    series text,
    image text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select i.id, i.user_id, i.wishlist_id, i.tcgdex_id, i.name, i.series, i.image
    from public.wishlist i
    join public.profiles p on p.id = i.user_id
    where i.user_id = p_user_id
      and p.is_public = true
      and p.wishlist_visible = true;
$$;

revoke all on function public.get_wishlist_items_public(uuid) from public, anon;
grant execute on function public.get_wishlist_items_public(uuid) to authenticated;

commit;

-- Rollback manuel si besoin :
-- begin;
-- drop function if exists public.get_wishlist_items_public(uuid);
-- drop function if exists public.get_wishlists_public(uuid);
-- drop function if exists public.get_cards_public(uuid);
-- drop view if exists public.profiles_public;
-- drop policy if exists "select public profiles" on public.profiles;
-- commit;
