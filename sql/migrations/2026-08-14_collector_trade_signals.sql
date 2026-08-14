-- Phase 5 (P5-2) — RPC d'agrégation des signaux d'échange pour la page Collecteurs.
-- Objectif : pour un lot de collecteurs publics déjà affichés côté client (p_target_ids, <=20
-- aujourd'hui, cf collectors.js), retourner en un seul aller-retour le nombre de tcgdex_id distincts
-- de wishlist qui correspondent à des doublons réellement échangeables, dans les deux sens, sans
-- charger la collection/wishlist complète de chacun (pas de N+1, cf audit Phase 5 §7/§10).
--
-- Réutilise strictement la sémantique déjà établie (P5-1, modules/collector-match.js +
-- modules/public-profile.js) :
--   - groupe de doublon = (tcgdex_id, finish), échangeable si sum(quantity) > 1 (le surplus, jamais
--     la quantité totale) ;
--   - la Wishlist ne connaît que "tcgdex_id recherché : oui/non", jamais de finish/quantité ;
--   - un compteur = nombre de tcgdex_id Wishlist distincts couverts, jamais un nombre de copies.
--
-- Duplication assumée et documentée (audité avant d'écrire ce fichier, cf échange P5-2) : le filtre
-- "raretés exclues des doublons à l'échange" (getPublicDuplicateEligibleCards, public-profile.js:65-76,
-- lui-même basé sur RARITY_ICON_MAP, modules/utils.js:189-241) ne peut pas être reproduit ici dans son
-- intégralité (~30 libellés, évolue avec TCGdex) sans devenir une vraie usine à gaz. Seules les valeurs
-- brutes qui alimentent AUJOURD'HUI les 3 groupes exclus (commune.webp/peu-commune.webp/holo.webp) sont
-- reprises ci-dessous. Si RARITY_ICON_MAP ou DUPLICATE_SECTION_EXCLUDED_RARITY_GROUPS changent côté JS,
-- cette liste doit être mise à jour manuellement en miroir - sinon le compteur Collecteurs et le détail
-- du profil public peuvent diverger (le risque exact signalé avant implémentation).

begin;

create or replace function public.get_collector_trade_signals(p_target_ids uuid[])
returns table (
    user_id uuid,
    for_me_count integer,
    for_them_count integer,
    is_reciprocal boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_viewer uuid := auth.uid();
begin
    -- Aucune session authentifiée : aucun résultat, jamais d'erreur (cf §11 de la demande) - de toute
    -- façon GRANT EXECUTE est restreint à authenticated plus bas, ce cas ne devrait jamais survenir en
    -- usage normal.
    if v_viewer is null then
        return;
    end if;

    return query
    with my_wishlist as (
        -- Ma wishlist : tcgdex_id distincts recherchés (pas de finish, pas de quantité - la table ne
        -- les connaît pas).
        select distinct w.tcgdex_id
        from public.wishlist w
        where w.user_id = v_viewer
          and w.tcgdex_id is not null and w.tcgdex_id <> ''
    ),
    my_duplicates as (
        -- Mes doublons réellement échangeables : groupe (tcgdex_id, finish), surplus > 0 (sum(quantity) > 1),
        -- collapsé en tcgdex_id distinct (deux finishes différents du même tcgdex_id comptent pour 1,
        -- cf §3/§9 de la demande - la wishlist ne distingue pas le finish).
        select distinct g.tcgdex_id
        from (
            select c.tcgdex_id, c.finish, sum(c.quantity) as total_qty
            from public.cards c
            where c.user_id = v_viewer
              and c.tcgdex_id is not null and c.tcgdex_id <> ''
              and lower(trim(c.rarity)) not in (
                  'commune', 'common', 'peu commune', 'uncommon',
                  'rare', 'rare holo', 'holo rare', 'holographique'
              )
            group by c.tcgdex_id, c.finish
        ) g
        where g.total_qty > 1
    ),
    targets as (
        -- Collecteurs ciblés, filtrés par confidentialité (is_public obligatoire, self exclu). Les
        -- flags collection_visible/wishlist_visible sont conservés par cible pour gater séparément
        -- chaque sens du matching plus bas - jamais un accès contournant la confidentialité.
        select p.id, p.collection_visible, p.wishlist_visible
        from public.profiles p
        where p.id = any(p_target_ids)
          and p.is_public = true
          and p.id <> v_viewer
    ),
    target_wishlist as (
        select w.user_id, w.tcgdex_id
        from public.wishlist w
        join targets t on t.id = w.user_id and t.wishlist_visible = true
        where w.tcgdex_id is not null and w.tcgdex_id <> ''
        group by w.user_id, w.tcgdex_id
    ),
    target_duplicates as (
        select g.user_id, g.tcgdex_id
        from (
            select c.user_id, c.tcgdex_id, c.finish, sum(c.quantity) as total_qty
            from public.cards c
            join targets t on t.id = c.user_id and t.collection_visible = true
            where c.tcgdex_id is not null and c.tcgdex_id <> ''
              and lower(trim(c.rarity)) not in (
                  'commune', 'common', 'peu commune', 'uncommon',
                  'rare', 'rare holo', 'holo rare', 'holographique'
              )
            group by c.user_id, c.tcgdex_id, c.finish
        ) g
        where g.total_qty > 1
        group by g.user_id, g.tcgdex_id
    ),
    for_me as (
        -- "Pour moi" : ses doublons échangeables ∩ ma wishlist.
        select td.user_id, count(distinct td.tcgdex_id) as cnt
        from target_duplicates td
        join my_wishlist mw on mw.tcgdex_id = td.tcgdex_id
        group by td.user_id
    ),
    for_them as (
        -- "Pour lui" : sa wishlist ∩ mes doublons échangeables.
        select tw.user_id, count(distinct tw.tcgdex_id) as cnt
        from target_wishlist tw
        join my_duplicates md on md.tcgdex_id = tw.tcgdex_id
        group by tw.user_id
    )
    select
        t.id as user_id,
        coalesce(fm.cnt, 0)::integer as for_me_count,
        coalesce(ft.cnt, 0)::integer as for_them_count,
        (coalesce(fm.cnt, 0) > 0 and coalesce(ft.cnt, 0) > 0) as is_reciprocal
    from targets t
    left join for_me fm on fm.user_id = t.id
    left join for_them ft on ft.user_id = t.id;
end;
$$;

-- Verrouillage identique aux RPC publiques existantes (get_cards_public et consorts) : search_path
-- figé, aucun accès anonyme, seul un utilisateur authentifié peut appeler cette fonction (et ne peut
-- de toute façon lire que SES propres doublons/wishlist via auth.uid(), jamais ceux d'un tiers - le
-- paramètre p_target_ids ne sert qu'à sélectionner les CIBLES, jamais le viewer).
revoke all on function public.get_collector_trade_signals(uuid[]) from public, anon;
grant execute on function public.get_collector_trade_signals(uuid[]) to authenticated;

-- =====================================================================================
-- Index — audités avant ajout (aucun index existant trouvé sur cards(user_id,...) ni
-- wishlist(user_id,...) dans les migrations du repo). Ciblés exactement sur la forme de requête
-- ci-dessus : égalité sur user_id, regroupement par tcgdex_id (+finish pour cards), quantity/rarity
-- inclus en covering pour éviter un accès au heap. Bénéficient aussi aux RPC existantes
-- get_cards_public/get_wishlist_items_public (même filtre user_id) sans les modifier.
-- =====================================================================================

create index if not exists idx_cards_user_tcgdex_finish
    on public.cards (user_id, tcgdex_id, finish)
    include (quantity, rarity);

create index if not exists idx_wishlist_user_tcgdex
    on public.wishlist (user_id, tcgdex_id);

commit;

-- Rollback manuel si besoin :
-- begin;
-- drop index if exists public.idx_wishlist_user_tcgdex;
-- drop index if exists public.idx_cards_user_tcgdex_finish;
-- drop function if exists public.get_collector_trade_signals(uuid[]);
-- commit;
