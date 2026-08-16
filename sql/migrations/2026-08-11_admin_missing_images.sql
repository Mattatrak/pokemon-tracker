-- Admin V1 — repérage et correction des cartes sans image canonique
-- Portée stricte : aucune RLS existante de cards/wishlist/profiles modifiée. admin_users est une
-- table séparée, jamais une colonne is_admin sur profiles (cf audit : profiles.upsert() est déjà
-- appelable par le propriétaire de la ligne sans restriction colonne par colonne en RLS Postgres -
-- une colonne is_admin y serait auto-attribuable par n'importe quel utilisateur, même faille de
-- classe que l'avatar_url XSS corrigé précédemment).

begin;

-- =====================================================================================
-- 1. ADMIN_USERS — verrouillée par construction : aucune policy pour authenticated/anon, donc
--    aucun chemin d'écriture accessible depuis l'API cliente. Provisionnement manuel uniquement :
--
--      insert into public.admin_users (user_id) values ('<votre-uuid-auth-users>');
--
--    (uuid trouvable dans Authentication > Users du dashboard Supabase)
-- =====================================================================================

create table public.admin_users (
    user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.admin_users enable row level security;
-- Volontairement aucune policy : select/insert/update/delete tous refusés par défaut pour
-- authenticated et anon. Seul un rôle bypassant RLS (postgres, service_role) peut y toucher.

-- =====================================================================================
-- 2. IS_ADMIN() — fonction réutilisable, même schéma que les fonctions publiques existantes
--    (search_path figé, security definer). Appelable par n'importe quel authentifié : elle ne
--    renseigne que sur SA PROPRE situation (auth.uid()), jamais sur celle d'un tiers.
-- =====================================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists(select 1 from public.admin_users where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- =====================================================================================
-- 3. GET_MISSING_IMAGE_CARDS() — lecture agrégée admin only. Ne retourne jamais de user_id,
--    uniquement un count(distinct ...) — aucune identité exposée. Bypass RLS de cards/wishlist
--    via security definer (propriétaire postgres, rolbypassrls = true, déjà confirmé pour
--    get_cards_public dans 2026-08-08_public_surfaces_phase2.sql) : ne modifie aucune policy
--    existante de ces deux tables.
--
--    ATTENTION : la version ci-dessous contient un bug (42702 "column reference tcgdex_id is
--    ambiguous" - RETURNS TABLE crée des variables PL/pgSQL portant les mêmes noms que les
--    colonnes, collision avec GROUP BY/ORDER BY/USING non qualifiés). Corrigée dans
--    2026-08-11b_fix_get_missing_image_cards.sql (create or replace, à exécuter après celle-ci).
-- =====================================================================================

create or replace function public.get_missing_image_cards()
returns table (
    tcgdex_id text,
    name text,
    series text,
    number text,
    rarity text,
    cards_count bigint,
    wishlist_count bigint,
    users_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.is_admin() then
        raise exception 'forbidden';
    end if;

    return query
    select
        coalesce(c.tcgdex_id, w.tcgdex_id)::text as tcgdex_id,
        coalesce(c.name, w.name)::text as name,
        coalesce(c.series, w.series)::text as series,
        coalesce(c.number, w.number)::text as number,
        coalesce(c.rarity, w.rarity)::text as rarity,
        coalesce(c.cards_count, 0) as cards_count,
        coalesce(w.wishlist_count, 0) as wishlist_count,
        (
            select count(distinct u.user_id) from (
                select user_id from public.cards
                where tcgdex_id = coalesce(c.tcgdex_id, w.tcgdex_id) and (image is null or image = '')
                union all
                select user_id from public.wishlist
                where tcgdex_id = coalesce(c.tcgdex_id, w.tcgdex_id) and (image is null or image = '')
            ) u
        ) as users_count
    from (
        select tcgdex_id, min(name) as name, min(series) as series, min(number) as number, min(rarity) as rarity, count(*) as cards_count
        from public.cards
        where (image is null or image = '') and tcgdex_id is not null and tcgdex_id <> ''
        group by tcgdex_id
    ) c
    full outer join (
        select tcgdex_id, min(name) as name, min(series) as series, min(number) as number, min(rarity) as rarity, count(*) as wishlist_count
        from public.wishlist
        where (image is null or image = '') and tcgdex_id is not null and tcgdex_id <> ''
        group by tcgdex_id
    ) w using (tcgdex_id)
    order by tcgdex_id;
end;
$$;

revoke all on function public.get_missing_image_cards() from public, anon;
grant execute on function public.get_missing_image_cards() to authenticated;

-- =====================================================================================
-- 4. ADMIN_SET_CARD_IMAGE(p_tcgdex_id, p_image_url) — écriture admin only, portée volontairement
--    étroite : ne touche QUE les lignes actuellement vides (garde image IS NULL OR image = ''),
--    ne réécrit jamais une image déjà présente (custom ou déjà correcte). Valide le format de
--    l'URL (même principe de défense en profondeur que la contrainte SQL sur profiles.avatar_url) :
--    doit être une URL publique du bucket card-images, chemin tcgdex/, pour éviter qu'un bug
--    client ou une session admin compromise n'injecte une valeur arbitraire dans une image vue
--    par tout le site.
-- =====================================================================================

create or replace function public.admin_set_card_image(p_tcgdex_id text, p_image_url text)
returns table (cards_updated bigint, wishlist_updated bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_cards_updated bigint;
    v_wishlist_updated bigint;
begin
    if not public.is_admin() then
        raise exception 'forbidden';
    end if;

    if p_tcgdex_id is null or p_tcgdex_id = '' then
        raise exception 'p_tcgdex_id requis';
    end if;

    if p_image_url is null or p_image_url !~ '^https://mmdcpkwygqsdaqnkimwb\.supabase\.co/storage/v1/object/public/card-images/tcgdex/' then
        raise exception 'p_image_url invalide : doit être une URL publique card-images/tcgdex/';
    end if;

    update public.cards
    set image = p_image_url
    where tcgdex_id = p_tcgdex_id and (image is null or image = '');
    get diagnostics v_cards_updated = row_count;

    update public.wishlist
    set image = p_image_url
    where tcgdex_id = p_tcgdex_id and (image is null or image = '');
    get diagnostics v_wishlist_updated = row_count;

    return query select v_cards_updated, v_wishlist_updated;
end;
$$;

revoke all on function public.admin_set_card_image(text, text) from public, anon;
grant execute on function public.admin_set_card_image(text, text) to authenticated;

commit;

-- Rollback manuel si besoin :
-- begin;
-- drop function if exists public.admin_set_card_image(text, text);
-- drop function if exists public.get_missing_image_cards();
-- drop function if exists public.is_admin();
-- drop table if exists public.admin_users;
-- commit;
