-- Audit sécurité 2026-09-04 (finding "Faible") : get_collector_trade_signals(p_target_ids uuid[])
-- est commentée "<=20 aujourd'hui" côté client (collectors.js), mais rien côté SQL ne fait respecter
-- cette limite. Un appel direct à supabase.rpc('get_collector_trade_signals', {p_target_ids: [...]})
-- avec un tableau de plusieurs milliers d'UUID (récupérables via la recherche Collecteurs, qui
-- n'expose que des profils publics) reste accepté et exécute les jointures/agrégations pour chaque
-- cible. Aucune fuite de données (is_public/collection_visible/wishlist_visible restent appliqués
-- par cible) : c'est un risque de charge (DoS applicatif mineur côté base), pas de confidentialité.
--
-- CREATE OR REPLACE suffit ici (signature et type de retour inchangés, seul le corps change).

create or replace function public.get_collector_trade_signals(p_target_ids uuid[])
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

    if array_length(p_target_ids, 1) > 50 then
        raise exception 'trop de cibles (max 50)';
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

-- Rollback manuel si besoin : réappliquer 2026-09-03_collector_preview_images.sql (fonction
-- identique, sans le garde-fou array_length).
