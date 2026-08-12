-- Phase 1 — Profils publics : identité (username) + réglages de confidentialité
-- Portée stricte : colonnes profiles uniquement. N'ouvre AUCUNE lecture publique.
-- cards / wishlist / wishlists : RLS non touchées par cette migration.
--
-- Prérequis avant d'exécuter : lancer la requête d'audit RLS ci-dessous sur profiles
-- et confirmer l'absence de policy permissive résiduelle avant de considérer ce
-- ticket terminé (cf. incident déjà rencontré sur cards/wishlist en 2026-07-30) :
--
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where tablename = 'profiles';
--
-- Cette migration ne modifie aucune policy RLS. Si l'audit révèle une policy
-- permissive sur profiles (ex. qual=true en SELECT), le signaler avant toute
-- ouverture de lecture publique en Phase 2 — pas d'action requise ici.

begin;

-- 1. Colonnes (nullable / default false : aucun profil existant n'est affecté,
--    tous restent privés par défaut, opt-in strict).
alter table public.profiles
    add column if not exists username text,
    add column if not exists is_public boolean not null default false,
    add column if not exists collection_visible boolean not null default false,
    add column if not exists wishlist_visible boolean not null default false;

-- 2. Format : lettres/chiffres/_/- , 3 à 20 caractères. NULL autorisé (comptes
--    existants n'ayant pas encore choisi de username) : un CHECK constraint est
--    automatiquement satisfait quand la colonne vaut NULL.
alter table public.profiles
    add constraint profiles_username_format
    check (username is null or username ~ '^[A-Za-z0-9_-]{3,20}$');

-- 3. Unicité insensible à la casse : index unique sur lower(username), pas de
--    colonne dupliquée (username_lower) ni d'extension citext nécessaire —
--    l'index d'expression est natif et suffisant sur toute version PostgreSQL
--    récente (Supabase). Partiel (where username is not null) pour ne pas
--    entrer en conflit tant qu'un compte n'a pas choisi de username.
create unique index if not exists profiles_username_lower_unique
    on public.profiles (lower(username))
    where username is not null;

commit;

-- Rollback manuel si besoin :
-- begin;
-- drop index if exists public.profiles_username_lower_unique;
-- alter table public.profiles drop constraint if exists profiles_username_format;
-- alter table public.profiles
--     drop column if exists username,
--     drop column if exists is_public,
--     drop column if exists collection_visible,
--     drop column if exists wishlist_visible;
-- commit;
