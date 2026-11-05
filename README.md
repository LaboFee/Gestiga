# Gestiga

Application installable pour gérer les demandes des passagers d’un véhicule de liaison.

## Architecture

- Interface : HTML, CSS et JavaScript natifs dans `index.html`, `style.css` et `app.js`.
- Backend : Supabase Auth, PostgreSQL, fonctions SQL et règles RLS.
- Rappels : Supabase Cron et fonctions hébergées avec notifications push.
- Emails du gestionnaire : Resend, appelé depuis une fonction hébergée.
- PWA : `manifest.json`, `sw.js`, icônes PNG et SVG.
- Hébergement statique : GitHub Pages, déploiement géré séparément.

Les noms des tables, colonnes, états et fonctions métier sont en français sans accents. Les noms imposés par Supabase, comme `auth.users` et `auth.uid()`, restent inchangés.

## Démarrage d’un projet Supabase neuf

1. Créer le projet Supabase et installer la CLI Supabase.
2. Depuis ce dossier, lier le projet puis appliquer les migrations présentes dans `supabase/migrations/` :

   ```text
   supabase link --project-ref <reference-du-projet>
   supabase db push
   ```

3. Dans `config.js`, renseigner l’URL, la clé publique Supabase et la clé publique VAPID. Ces valeurs publiques ne remplacent pas les protections RLS.
4. Créer le premier compte dans Gestiga. Dans l’éditeur SQL Supabase, activer ce compte comme premier gestionnaire en remplaçant l’adresse :

   ```sql
   update public.profils
   set statut_compte = 'actif'
   where courriel = 'gestionnaire@exemple.ci';

   insert into public.roles_utilisateur (profil_id, role)
   select id, 'gestionnaire'
   from public.profils
   where courriel = 'gestionnaire@exemple.ci'
   on conflict do nothing;
   ```

5. Connecté comme gestionnaire, configurer l’adresse de réception des emails, les véhicules, leur capacité et les destinations. Les comptes créés ensuite restent en attente jusqu’à leur validation.
6. La migration active Supabase Vault, Cron et pg_net. Ajouter les deux secrets utilisés par les tâches planifiées dans l’éditeur SQL :

   ```sql
   select vault.create_secret('https://<reference>.supabase.co', 'url_projet');
   select vault.create_secret('<cle-service-role>', 'cle_service');
   ```

   Puis définir les secrets des fonctions hébergées :

   ```text
   supabase secrets set RESEND_API_KEY=... EXPEDITEUR_COURRIEL="Gestiga <adresse@domaine-verifie.ci>" VAPID_SUJET=mailto:contact@domaine.ci VAPID_CLE_PUBLIQUE=... VAPID_CLE_PRIVEE=...
   ```

7. Déployer les fonctions :

   ```text
   supabase functions deploy envoyer-rappels
   supabase functions deploy notifier-gestionnaire
   ```

8. Publier le contenu de ce dossier sur GitHub Pages. L’installation PWA et les notifications push exigent HTTPS.

## Règles intégrées

- Jours de service : lundi à vendredi, fuseau `Africa/Abidjan`, avec fermetures configurables dans `regles_calendrier`.
- Chaque utilisateur crée son compte individuel ; le gestionnaire valide l’inscription et choisit la catégorie de passager.
- Les demandes des titulaires sont générées automatiquement et acceptées si la capacité le permet. Si les titulaires sont plus nombreux que les places, les demandes sont soumises au gestionnaire.
- Les demandes des invités restent en attente jusqu’à la décision du gestionnaire. L’interface affiche les priorités des passagers et des destinations.
- Les demandes manuelles sont limitées à l’heure configurée, initialement 16 h 30.
- Chaque mouvement d’une demande alimente la file d’emails du gestionnaire.
- Les remarques sont visibles par leur auteur et par le gestionnaire, jamais par le conducteur.
- Les rappels de 12 h 05 et 16 h 05 visent les deux catégories de passagers. Le navigateur doit avoir autorisé les notifications.

## Configuration locale

Ouvrir `index.html` depuis un serveur HTTP local ou publier le dossier sur GitHub Pages. Les clés Supabase sont à renseigner dans `config.js`. Ne jamais ajouter la clé `service_role` ou la clé Resend au code du navigateur.

Les anciennes migrations, conservées dans `supabase/archives/migrations/`, ne font pas partie du nouveau schéma et ne sont pas appliquées par Supabase CLI.
