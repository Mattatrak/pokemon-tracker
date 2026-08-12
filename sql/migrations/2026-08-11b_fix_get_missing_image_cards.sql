-- Fix : get_missing_image_cards() levait "column reference tcgdex_id is ambiguous" (42702).
-- Cause : RETURNS TABLE (tcgdex_id text, name text, series text, number text, rarity text, ...)
-- crée implicitement des variables PL/pgSQL portant EXACTEMENT ces noms - toute référence non
-- qualifiée à une colonne "tcgdex_id"/"name"/"series"/"number"/"rarity" dans le corps de la
-- fonction (GROUP BY, ORDER BY, USING, WHERE) devient ambiguë entre la variable de sortie et la
-- colonne de table. Correction : alias courts et systématiquement qualifiés (aucune référence
-- bare aux noms de colonnes de sortie), remplace le create or replace du 2026-08-11.

begin;

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
        coalesce(cc.id, ww.id),
        coalesce(cc.nm, ww.nm),
        coalesce(cc.sr, ww.sr),
        coalesce(cc.nb, ww.nb),
        coalesce(cc.rr, ww.rr),
        coalesce(cc.cnt, 0::bigint),
        coalesce(ww.cnt, 0::bigint),
        (
            select count(distinct u.uid) from (
                select cards.user_id as uid
                from public.cards
                where cards.tcgdex_id = coalesce(cc.id, ww.id) and (cards.image is null or cards.image = '')
                union all
                select wishlist.user_id as uid
                from public.wishlist
                where wishlist.tcgdex_id = coalesce(cc.id, ww.id) and (wishlist.image is null or wishlist.image = '')
            ) u
        )
    from (
        select
            cards.tcgdex_id as id,
            min(cards.name) as nm,
            min(cards.series) as sr,
            min(cards.number) as nb,
            min(cards.rarity) as rr,
            count(*) as cnt
        from public.cards
        where (cards.image is null or cards.image = '') and cards.tcgdex_id is not null and cards.tcgdex_id <> ''
        group by cards.tcgdex_id
    ) cc
    full outer join (
        select
            wishlist.tcgdex_id as id,
            min(wishlist.name) as nm,
            min(wishlist.series) as sr,
            min(wishlist.number) as nb,
            min(wishlist.rarity) as rr,
            count(*) as cnt
        from public.wishlist
        where (wishlist.image is null or wishlist.image = '') and wishlist.tcgdex_id is not null and wishlist.tcgdex_id <> ''
        group by wishlist.tcgdex_id
    ) ww on cc.id = ww.id
    order by coalesce(cc.id, ww.id);
end;
$$;

revoke all on function public.get_missing_image_cards() from public, anon;
grant execute on function public.get_missing_image_cards() to authenticated;

commit;
