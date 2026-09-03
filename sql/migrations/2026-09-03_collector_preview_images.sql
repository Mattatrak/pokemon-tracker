-- Niveau B "Refonte cartes Collectionneurs" (mémoire collectors_redesign_tier_b_deferred, validé le
-- 2026-09-03 : "on se note le B pour plus tard") — étend get_collector_trade_signals (2026-08-14) pour
-- renvoyer aussi jusqu'à 3 images de la collection de chaque cible, permettant un aperçu visuel (3
-- vignettes) sur les cartes Collecteurs sans nouvel appel réseau par profil (même principe déjà en
-- place pour éviter le N+1, cf commentaire de la migration d'origine).
--
-- Choix des 3 cartes : les plus récemment ajoutées (created_at desc) avec une image renseignée -
-- reflète "ce que la personne vient d'ajouter", cohérent avec l'esprit d'un aperçu dynamique plutôt
-- qu'un tri par valeur (déjà écarté par ailleurs dans ce fichier - jamais de score de compatibilité).
-- Gaté par collection_visible comme le reste de la RPC : jamais d'image renvoyée pour une collection
-- masquée, même si le profil lui-même est public.
--
-- CREATE OR REPLACE ne suffit pas ici : le type de retour change (nouvelle colonne), Postgres exige un
-- DROP explicite avant de recréer la fonction avec une signature de retour différente.

begin;

drop function if exists public.get_collector_trade_signals(uuid[]);

create function public.get_collector_trade_signals(p_target_ids uuid[])
returns table (
    user_id uuid,
    for_me_count integer,
    for_them_count integer,
    is_reciprocal boolean,
    preview_images text[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_viewer uuid := auth.uid();
begin
    if v_viewer is null then
        return;
    end if;

    return query
    with my_wishlist as (
        select distinct w.tcgdex_id
        from public.wishlist w
        where w.user_id = v_viewer
          and w.tcgdex_id is not null and w.tcgdex_id <> ''
    ),
    my_duplicates as (
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
        select td.user_id, count(distinct td.tcgdex_id) as cnt
        from target_duplicates td
        join my_wishlist mw on mw.tcgdex_id = td.tcgdex_id
        group by td.user_id
    ),
    for_them as (
        select tw.user_id, count(distinct tw.tcgdex_id) as cnt
        from target_wishlist tw
        join my_duplicates md on md.tcgdex_id = tw.tcgdex_id
        group by tw.user_id
    ),
    target_previews as (
        -- Niveau B : jusqu'à 3 images par cible, uniquement si la collection est visible. array()
        -- plutôt qu'un LEFT JOIN LATERAL + array_agg : plus direct pour "les 3 dernières par cible",
        -- exécuté une fois par ligne de targets (borné à p_target_ids, <=20 aujourd'hui).
        select
            t.id as user_id,
            array(
                select c.image
                from public.cards c
                where c.user_id = t.id
                  and c.image is not null and c.image <> ''
                order by c.created_at desc
                limit 3
            ) as preview_images
        from targets t
        where t.collection_visible = true
    )
    select
        t.id as user_id,
        coalesce(fm.cnt, 0)::integer as for_me_count,
        coalesce(ft.cnt, 0)::integer as for_them_count,
        (coalesce(fm.cnt, 0) > 0 and coalesce(ft.cnt, 0) > 0) as is_reciprocal,
        coalesce(tp.preview_images, '{}'::text[]) as preview_images
    from targets t
    left join for_me fm on fm.user_id = t.id
    left join for_them ft on ft.user_id = t.id
    left join target_previews tp on tp.user_id = t.id;
end;
$$;

revoke all on function public.get_collector_trade_signals(uuid[]) from public, anon;
grant execute on function public.get_collector_trade_signals(uuid[]) to authenticated;

-- Nouvel accès (user_id, created_at desc) pour "les 3 dernières cartes avec image" - aucun index
-- existant ne couvre ce tri (idx_cards_user_tcgdex_finish est sur tcgdex_id/finish, pas created_at).
create index if not exists idx_cards_user_created_at
    on public.cards (user_id, created_at desc)
    include (image);

commit;

-- Rollback manuel si besoin :
-- begin;
-- drop index if exists public.idx_cards_user_created_at;
-- drop function if exists public.get_collector_trade_signals(uuid[]);
-- -- puis recréer la version 2026-08-14_collector_trade_signals.sql telle quelle si besoin de revenir en arrière.
-- commit;
