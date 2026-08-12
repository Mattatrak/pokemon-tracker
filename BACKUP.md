# Backups PokéTracker

Sauvegarde automatique de la base de données Supabase, quotidienne, via GitHub Actions.
Workflow : [`.github/workflows/database-backup.yml`](.github/workflows/database-backup.yml).

## Ce qui est sauvegardé

- **Schéma** (`schema.sql`) : tables, vues, indexes, contraintes, fonctions/RPC, triggers, **policies RLS**
- **Données** (`data.sql`) : toutes les lignes des tables du schéma `public` (`profiles`, `cards`, `wishlists`, `wishlist`, `card_price_history`, `admin_users`, `value_history`, `monthly_summary`, `favorites`, etc.)
- **Rôles** (`roles.sql`) : rôles Postgres personnalisés

Les 3 fichiers sont regroupés dans une seule archive `poketracker-db-<date>_<heure>UTC.tar.gz`.

## Ce qui N'EST PAS sauvegardé (pour l'instant)

- **Supabase Storage** (bucket `card-images`) — hors scope de ce ticket, prévu séparément.
- **Utilisateurs d'authentification** (`auth.users`, mots de passe, sessions) — `supabase db dump` exclut par construction les schémas internes `auth`/`storage`. Une vraie sauvegarde des comptes utilisateurs nécessite une méthode différente (Auth Admin API), à traiter dans un ticket dédié si besoin.
- Toute donnée hors du schéma `public` (extensions, schémas internes Supabase).

## Secret requis

Un seul secret GitHub : **`SUPABASE_DB_URL`**.

### Comment le récupérer

1. Dashboard Supabase → projet PokéTracker → bouton **Connect** (en haut de la page).
2. Choisir le mode **Session pooler** (⚠️ pas "Direct connection", pas "Transaction pooler" — cf. explication plus bas).
3. Copier la chaîne de connexion complète, du type :
   ```
   postgresql://postgres.[project-ref]:[password]@aws-[region].pooler.supabase.com:5432/postgres
   ```
4. Remplacer `[password]` par le vrai mot de passe de la base (percent-encodé s'il contient des caractères spéciaux comme `@`, `/`, `#`).
   - Mot de passe oublié → **Project Settings → Database → Database password → Reset database password**.

### Pourquoi Session pooler et pas Direct connection

Les runners GitHub Actions sont IPv4-only. La "Direct connection" Supabase (`db.[project-id].supabase.co`) exige IPv6 sur le plan Free (sans l'add-on IPv4 payant) — le workflow échouerait en timeout. Le **Session pooler** est IPv4 sur tous les plans, y compris gratuit, et convient à une connexion de type `pg_dump` (contrairement au Transaction pooler, pensé pour des connexions courtes et qui ne supporte pas les prepared statements).

### Ajouter le secret dans GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret** → nom `SUPABASE_DB_URL`, valeur = la chaîne de connexion complète (avec mot de passe).

Aucune autre valeur n'est nécessaire : pas de `SUPABASE_ACCESS_TOKEN` (pas de `supabase link` requis, `--db-url` fonctionne seul), pas de clé `service_role`.

## Lancer une sauvegarde manuellement

Repo GitHub → onglet **Actions** → workflow **PokéTracker Database Backup** → bouton **Run workflow**.

## Télécharger un backup

Repo GitHub → onglet **Actions** → cliquer sur une exécution du workflow → section **Artifacts** en bas de page → télécharger le `.zip` (qui contient l'archive `.tar.gz`).

Rétention actuelle : **30 jours**. Au-delà, l'artifact disparaît automatiquement — ce n'est pas un stockage long terme, juste un filet de sécurité à court terme.

## Procédure de restauration (projet Supabase de test)

À tester dans un **projet Supabase séparé**, jamais directement sur le projet de production.

### Prérequis

- Un projet Supabase de test (nouveau projet, vide).
- `psql` installé localement, ou la CLI Supabase.
- L'archive téléchargée et extraite (`schema.sql`, `data.sql`, `roles.sql`).

### Étapes

Utiliser la connexion **Session pooler** du projet de test (même logique que pour le backup), dans cet ordre précis — les rôles et le schéma doivent exister avant d'insérer les données :

```bash
# 1. Rôles (si le dump en contient de personnalisés)
psql "postgresql://postgres.[ref-test]:[password]@aws-[region].pooler.supabase.com:5432/postgres" -f roles.sql

# 2. Schéma (tables, RLS, fonctions, triggers, indexes, contraintes)
psql "postgresql://postgres.[ref-test]:[password]@aws-[region].pooler.supabase.com:5432/postgres" -f schema.sql

# 3. Données
psql "postgresql://postgres.[ref-test]:[password]@aws-[region].pooler.supabase.com:5432/postgres" -f data.sql
```

### Vérifications après restauration

- Le nombre de lignes dans les tables clés (`cards`, `wishlists`, `wishlist`) correspond à ce qui était attendu.
- Les policies RLS sont bien présentes (`select * from pg_policies;`).
- Les fonctions/RPC utilisées par l'app (`is_admin`, `get_wishlist_items_public`, etc.) existent et s'exécutent sans erreur.
- Aucune donnée `auth.users` n'est présente — normal, non couvert par ce backup (cf plus haut). Un projet de test nécessite donc de recréer manuellement un compte pour se connecter à l'app pointée dessus.

### Ce qui manquera après une restauration complète

- Les images du bucket Storage `card-images` (pas encore sauvegardées, ticket séparé).
- Les comptes utilisateurs Auth (email/mot de passe, sessions) — à recréer manuellement dans le projet de test.
