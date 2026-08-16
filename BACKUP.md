# Backups PokéTracker

Deux workflows GitHub Actions indépendants, quotidiens :
- **Base de données** — [`.github/workflows/database-backup.yml`](.github/workflows/database-backup.yml) (02:00 UTC)
- **Storage (`card-images`)** — [`.github/workflows/storage-backup.yml`](.github/workflows/storage-backup.yml) (03:00 UTC)

Décalés d'une heure pour ne pas cumuler la charge sur l'API Supabase, mais totalement indépendants l'un de l'autre (aucun ne dépend du succès de l'autre).

## Politique actuelle de sauvegarde

**Database**
- Exécution automatique quotidienne, **02:00 UTC**
- Rétention GitHub Artifact : **30 jours**
- Lancement manuel possible (`workflow_dispatch`)

**Storage**
- Exécution automatique quotidienne, **03:00 UTC**
- Rétention GitHub Artifact : **30 jours**
- Lancement manuel possible (`workflow_dispatch`)

Les deux pipelines sont **volontairement décalés d'une heure** pour ne pas cumuler la charge sur l'API Supabase au même moment — ils restent indépendants l'un de l'autre (le succès/échec de l'un n'affecte pas l'autre).

**GitHub Artifacts est pour l'instant une rétention court terme** (30 jours glissants, pas de stockage long terme) — une copie hors GitHub (S3, R2, Drive, etc.) pourra être ajoutée plus tard si besoin, dans un ticket séparé.

Un backup manuel (`workflow_dispatch`, sur les deux workflows) peut être lancé à tout moment avant une migration ou une release importante, en plus du cron quotidien.

**Volontairement pas encore en place** : rotation hebdomadaire/mensuelle, destination externe (S3/R2/Backblaze/Drive), chiffrement additionnel, notifications, suppression personnalisée des anciens backups. Un backup par jour + 30 jours glissants suffit pour l'instant.

---

# Base de données

## Ce qui est sauvegardé

- **Schéma** (`schema.sql`) : tables, vues, indexes, contraintes, fonctions/RPC, triggers, **policies RLS**
- **Données** (`data.sql`) : toutes les lignes des tables du schéma `public` (`profiles`, `cards`, `wishlists`, `wishlist`, `card_price_history`, `admin_users`, `value_history`, `monthly_summary`, `favorites`, etc.)
- **Rôles** (`roles.sql`) : rôles Postgres personnalisés

Les 3 fichiers sont regroupés dans une seule archive `poketracker-db-<date>_<heure>UTC.tar.gz`.

## Ce qui N'EST PAS sauvegardé (pour l'instant)

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

**Validée en conditions réelles le 2026-08-12** (restauration testée de bout en bout sur un vrai projet de test, données de prod : 791 cartes, 4 wishlists, 18 items, 30 policies RLS, 6 fonctions RPC — toutes retrouvées intactes).

À tester dans un **projet Supabase séparé**, jamais directement sur le projet de production.

### Prérequis

- Un projet Supabase de test (nouveau projet, vide).
- Node.js installé localement (pour lancer la CLI Supabase via `npx`, sans installation permanente — la CLI Supabase ne supporte pas `npm install -g`).
- L'archive téléchargée et extraite (`schema.sql`, `data.sql`, `roles.sql`).

Pas besoin de `psql` : la CLI embarque tout ce qu'il faut.

### Étapes

1. **Placer les fichiers dans la structure attendue par la CLI.** Depuis un dossier de travail (ex. `Downloads`), les 3 fichiers doivent être dans un sous-dossier nommé exactement `supabase/`, avec `schema.sql`/`data.sql` renommés en migrations timestampées dans `supabase/migrations/` :

   ```bash
   cd chemin/vers/dossier-de-travail/supabase
   cp schema.sql migrations/00000000000001_schema.sql
   cp data.sql migrations/00000000000002_data.sql
   cd ..
   ```

   Structure finale attendue :
   ```
   dossier-de-travail/
     supabase/
       roles.sql
       migrations/
         00000000000001_schema.sql
         00000000000002_data.sql
   ```

2. **Restaurer en une seule commande**, depuis `dossier-de-travail` (celui qui contient `supabase/`), avec la connexion **Session pooler** du projet de test :

   ```bash
   npx -y supabase@latest db push --db-url "postgresql://postgres.[ref-test]:[password]@aws-[region].pooler.supabase.com:5432/postgres" --include-roles
   ```

   `--include-roles` applique `supabase/roles.sql` en premier, puis les migrations sont appliquées dans l'ordre (schéma avant données, grâce au préfixe timestamp).

### Vérifications après restauration

Toujours via la CLI, pas besoin de `psql` :

```bash
npx -y supabase@latest db query --db-url "<connexion test>" "select 'cards' as t, count(*) from public.cards union all select 'wishlists', count(*) from public.wishlists union all select 'wishlist', count(*) from public.wishlist;"

npx -y supabase@latest db query --db-url "<connexion test>" "select count(*) as policy_count from pg_policies where schemaname='public';"

npx -y supabase@latest db query --db-url "<connexion test>" "select routine_name from information_schema.routines where routine_schema='public' order by routine_name;"
```

- Le nombre de lignes dans les tables clés (`cards`, `wishlists`, `wishlist`) correspond à ce qui était attendu.
- Le nombre de policies RLS correspond à ce qui était attendu.
- Les fonctions/RPC utilisées par l'app (`is_admin`, `get_wishlist_items_public`, `admin_set_card_image`, `get_cards_public`, `get_missing_image_cards`, `get_wishlists_public`) existent toutes.
- Aucune donnée `auth.users` n'est présente — normal, non couvert par ce backup (cf plus haut). Un projet de test nécessite donc de recréer manuellement un compte pour se connecter à l'app pointée dessus.

**Note** : `supabase db query` fait remonter automatiquement des alertes de sécurité structurelles (ex. RLS désactivée sur une table) au-dessus du résultat de la requête — utile à surveiller, indépendant du contenu du backup lui-même.

### Ce qui manquera après une restauration complète

- Les images du bucket Storage `card-images` — voir la section Storage ci-dessous, sauvegardées séparément.
- Les comptes utilisateurs Auth (email/mot de passe, sessions) — à recréer manuellement dans le projet de test.

### Après un test de restauration

- **Supprimer le projet Supabase de test** une fois la vérification terminée — ne pas laisser traîner une copie des données de prod.
- Si le mot de passe du projet de test a été partagé (chat, ticket, etc.), le régénérer par précaution même si le projet est ensuite supprimé.

---

# Storage (`card-images`)

## Ce qui est sauvegardé

Tous les fichiers du bucket `card-images`, arborescence complète (`ball/`, `custom/`, `energy/`, `logos/`, `symbols/`, `tcgdex/...`), listés récursivement puis téléchargés un par un, regroupés dans `poketracker-storage-<date>_<heure>UTC.tar.gz`.

Script : [`.github/scripts/backup-storage.mjs`](.github/scripts/backup-storage.mjs). Testé en conditions réelles le 2026-08-12 : 725 fichiers, ~40,5 Mo, arborescence (y compris les sous-dossiers imbriqués) intacte après téléchargement.

## Ce qui N'EST PAS sauvegardé

- Les autres buckets Storage éventuels (ce workflow ne couvre que `card-images`).
- Les métadonnées Storage internes non exposées par `list()` (policies du bucket lui-même, configuration) — seuls les fichiers et leur chemin sont sauvegardés, pas la configuration du bucket.

## Méthode et secrets requis

**REST API Storage + clé `anon`, pas de `service_role`, pas de jeton de compte Supabase.** Le bucket `card-images` est configuré public : `list()` et le téléchargement fonctionnent avec la clé `anon` sans policy SELECT dédiée sur `storage.objects` — vérifié empiriquement (requêtes réelles contre le bucket) avant d'écrire le workflow, pas juste supposé.

Deux secrets GitHub, tous deux déjà publics par nature (visibles dans le code source client de l'app), mis en secrets par propreté plutôt que par nécessité de confidentialité stricte :
- `SUPABASE_PROJECT_URL` : `https://[project-ref].supabase.co`
- `SUPABASE_ANON_KEY` : la clé `anon` du projet (Dashboard → Project Settings → API)

## Lancer une sauvegarde manuellement

Repo GitHub → onglet **Actions** → workflow **PokéTracker Storage Backup** → bouton **Run workflow**.

## Télécharger un backup

Même procédure que pour la base : Actions → l'exécution du workflow → section **Artifacts** → télécharger le `.zip` (contient l'archive `.tar.gz`). Rétention 30 jours, même logique que le backup base de données (filet de sécurité court terme, pas un stockage long terme).

## Procédure de restauration

Pas encore documentée/testée — à faire dans un prochain ticket (ré-upload des fichiers vers le bucket d'un projet de test via l'API Storage ou la CLI, en conservant l'arborescence).
