-- Gestiga : schema initial, noms et commentaires en francais.
-- A appliquer sur une base neuve apres sauvegarde et reinitialisation explicite.
-- Ce fichier ne contient aucune instruction de suppression.

create extension if not exists pgcrypto;

create schema if not exists prive;

create type public.role_application as enum ('gestionnaire', 'conducteur', 'passager');
create type public.categorie_passager as enum ('titulaire', 'invite');
create type public.statut_compte as enum ('en_attente', 'actif', 'suspendu');
create type public.statut_jour_service as enum ('planifie', 'annule');
create type public.statut_demande as enum ('en_attente', 'acceptee', 'refusee', 'annule');
create type public.origine_demande as enum ('manuelle', 'automatique');
create type public.statut_remarque as enum ('visible', 'retiree');
create type public.statut_envoi_courriel as enum ('en_attente', 'en_traitement', 'envoye', 'echec');

create table public.profils (
  id uuid primary key references auth.users (id) on delete cascade,
  nom_affiche text not null default '',
  courriel text,
  statut_compte public.statut_compte not null default 'en_attente',
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create table public.roles_utilisateur (
  profil_id uuid not null references public.profils (id) on delete cascade,
  role public.role_application not null,
  cree_le timestamptz not null default now(),
  primary key (profil_id, role)
);

create table public.passagers (
  profil_id uuid primary key references public.profils (id) on delete cascade,
  categorie public.categorie_passager not null,
  rang_priorite integer not null default 100 check (rang_priorite >= 0),
  est_actif boolean not null default true,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  rang_priorite integer not null default 100 check (rang_priorite >= 0),
  est_actif boolean not null default true,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create table public.destinations_par_defaut_passager (
  profil_id uuid not null references public.passagers (profil_id) on delete cascade,
  destination_id uuid not null references public.destinations (id) on delete restrict,
  rang_preference integer not null default 1 check (rang_preference > 0),
  cree_le timestamptz not null default now(),
  primary key (profil_id, destination_id),
  unique (profil_id, rang_preference)
);

create table public.vehicules (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  places_totales integer not null check (places_totales > 0),
  est_actif boolean not null default true,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create table public.jours_service (
  id uuid primary key default gen_random_uuid(),
  date_service date not null,
  vehicule_id uuid not null references public.vehicules (id) on delete restrict,
  conducteur_id uuid references public.profils (id) on delete set null,
  statut public.statut_jour_service not null default 'planifie',
  cree_par uuid references public.profils (id) on delete set null,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  unique (date_service, vehicule_id),
  unique (id, date_service)
);

create table public.destinations_jour_service (
  jour_service_id uuid not null references public.jours_service (id) on delete cascade,
  destination_id uuid not null references public.destinations (id) on delete restrict,
  rang_priorite integer not null default 100 check (rang_priorite >= 0),
  primary key (jour_service_id, destination_id)
);

create table public.demandes_transport (
  id uuid primary key default gen_random_uuid(),
  jour_service_id uuid not null references public.jours_service (id) on delete restrict,
  profil_id uuid not null references public.passagers (profil_id) on delete restrict,
  date_service date not null,
  destination_id uuid not null,
  origine public.origine_demande not null default 'manuelle',
  statut public.statut_demande not null default 'en_attente',
  decide_par uuid references public.profils (id) on delete set null,
  decide_le timestamptz,
  note_decision text,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  unique (jour_service_id, profil_id),
  foreign key (jour_service_id, date_service)
    references public.jours_service (id, date_service) on delete restrict,
  foreign key (jour_service_id, destination_id)
    references public.destinations_jour_service (jour_service_id, destination_id) on delete restrict,
  check (statut not in ('acceptee', 'refusee') or decide_le is not null)
);

create table public.remarques_conducteur (
  id uuid primary key default gen_random_uuid(),
  jour_service_id uuid not null references public.jours_service (id) on delete restrict,
  profil_id uuid not null references public.passagers (profil_id) on delete restrict,
  conducteur_id uuid not null references public.profils (id) on delete restrict,
  note smallint check (note between 1 and 5),
  texte text not null check (length(trim(texte)) > 0),
  statut public.statut_remarque not null default 'visible',
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create table public.evenements_demande (
  id bigint generated always as identity primary key,
  demande_id uuid not null references public.demandes_transport (id) on delete restrict,
  action text not null check (action in ('cree', 'statut_modifie', 'destination_modifie')),
  acteur_id uuid references public.profils (id) on delete set null,
  ancien_statut public.statut_demande,
  nouveau_statut public.statut_demande,
  ancienne_destination_id uuid references public.destinations (id) on delete set null,
  nouvelle_destination_id uuid references public.destinations (id) on delete set null,
  survenu_le timestamptz not null default now()
);

create table public.file_courriels (
  id bigint generated always as identity primary key,
  evenement_demande_id bigint not null unique references public.evenements_demande (id) on delete restrict,
  statut public.statut_envoi_courriel not null default 'en_attente',
  tentatives integer not null default 0 check (tentatives >= 0),
  derniere_erreur text,
  cree_le timestamptz not null default now(),
  envoye_le timestamptz
);

create table public.parametres_application (
  instance_unique boolean primary key default true check (instance_unique),
  courriel_gestionnaire text,
  fuseau_horaire text not null default 'Africa/Abidjan',
  heures_rappel time[] not null default array['12:05'::time, '16:05'::time],
  jours_ouvres smallint[] not null default array[1, 2, 3, 4, 5]::smallint[],
  heure_limite_demande time not null default '16:30',
  modifie_le timestamptz not null default now(),
  check (courriel_gestionnaire is null or position('@' in courriel_gestionnaire) > 1)
);

create table public.regles_calendrier (
  date_regle date primary key,
  est_jour_service boolean not null,
  libelle text,
  cree_par uuid references public.profils (id) on delete set null,
  cree_le timestamptz not null default now()
);

insert into public.parametres_application (instance_unique) values (true);

create table public.abonnements_notifications (
  id uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils (id) on delete cascade,
  point_acces text not null unique,
  cles jsonb not null,
  cree_le timestamptz not null default now()
);

create index jours_service_date_statut_idx on public.jours_service (date_service, statut);
create index jours_service_conducteur_date_idx on public.jours_service (conducteur_id, date_service);
create index demandes_passager_date_idx on public.demandes_transport (profil_id, date_service);
create index demandes_jour_statut_idx on public.demandes_transport (jour_service_id, statut);
create index remarques_jour_idx on public.remarques_conducteur (jour_service_id, cree_le desc);
create index evenements_demande_date_idx on public.evenements_demande (demande_id, survenu_le desc);
create index file_courriels_attente_idx on public.file_courriels (cree_le) where statut = 'en_attente';

create function prive.a_role(_role public.role_application)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.roles_utilisateur ur
    join public.profils p on p.id = ur.profil_id
    where ur.profil_id = (select auth.uid())
      and ur.role = _role
      and p.statut_compte = 'actif'
  );
$$;

create function prive.profil_a_role(_profil_id uuid, _role public.role_application)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.roles_utilisateur ru
    join public.profils p on p.id = ru.profil_id
    where ru.profil_id = _profil_id and ru.role = _role and p.statut_compte = 'actif'
  );
$$;

revoke all on function prive.a_role(public.role_application) from public;
revoke all on function prive.profil_a_role(uuid, public.role_application) from public;
grant usage on schema prive to authenticated;
grant execute on function prive.a_role(public.role_application) to authenticated;
grant execute on function prive.profil_a_role(uuid, public.role_application) to authenticated;

create function prive.creer_profil_utilisateur_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profils (id, nom_affiche)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nom_affiche', new.raw_user_meta_data ->> 'nom_complet', new.raw_user_meta_data ->> 'full_name', '')
  ) on conflict (id) do nothing;
  update public.profils set courriel = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function prive.creer_profil_utilisateur_auth();

create function prive.actualiser_date_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.modifie_le = now();
  return new;
end;
$$;

create trigger profils_maj_date before update on public.profils
  for each row execute function prive.actualiser_date_modification();
create trigger passagers_maj_date before update on public.passagers
  for each row execute function prive.actualiser_date_modification();
create trigger destinations_maj_date before update on public.destinations
  for each row execute function prive.actualiser_date_modification();
create trigger vehicules_maj_date before update on public.vehicules
  for each row execute function prive.actualiser_date_modification();
create trigger jours_service_maj_date before update on public.jours_service
  for each row execute function prive.actualiser_date_modification();
create trigger demandes_maj_date before update on public.demandes_transport
  for each row execute function prive.actualiser_date_modification();
create trigger remarques_maj_date before update on public.remarques_conducteur
  for each row execute function prive.actualiser_date_modification();
create trigger parametres_maj_date before update on public.parametres_application
  for each row execute function prive.actualiser_date_modification();

create function prive.synchroniser_priorite_destination()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.rang_priorite is distinct from new.rang_priorite then
    update public.destinations_jour_service
    set rang_priorite = new.rang_priorite
    where destination_id = new.id;
  end if;
  return new;
end;
$$;

create trigger destinations_synchroniser_priorite
  after update of rang_priorite on public.destinations
  for each row execute function prive.synchroniser_priorite_destination();

create function prive.verifier_capacite_vehicule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.places_totales < old.places_totales and exists (
    select 1
    from public.jours_service js
    join public.demandes_transport dt on dt.jour_service_id = js.id
    where js.vehicule_id = new.id
      and js.statut = 'planifie'
      and dt.statut = 'acceptee'
    group by js.id
    having count(*) > new.places_totales
  ) then
    raise exception 'La capacite ne peut pas etre inferieure au nombre de demandes acceptees' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger vehicules_verifier_capacite
  before update of places_totales on public.vehicules
  for each row execute function prive.verifier_capacite_vehicule();

create function prive.annuler_demandes_passager_desactive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.est_actif and not new.est_actif then
    update public.demandes_transport
    set statut = 'annule', decide_par = null, decide_le = null, note_decision = null
    where profil_id = new.profil_id
      and date_service >= (now() at time zone 'Africa/Abidjan')::date
      and statut in ('en_attente', 'acceptee');
  end if;
  return new;
end;
$$;

create trigger passagers_annuler_demandes_desactivation
  after update of est_actif on public.passagers
  for each row execute function prive.annuler_demandes_passager_desactive();

create function prive.journaliser_evenement_demande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_evenement text;
begin
  if tg_op = 'INSERT' then
    insert into public.evenements_demande (demande_id, action, acteur_id, nouveau_statut, nouvelle_destination_id)
    values (new.id, 'cree', (select auth.uid()), new.statut, new.destination_id);
    return new;
  end if;

  if old.statut is distinct from new.statut then
    action_evenement := 'statut_modifie';
  elsif old.destination_id is distinct from new.destination_id then
    action_evenement := 'destination_modifie';
  else
    return new;
  end if;

  insert into public.evenements_demande (
    demande_id, action, acteur_id, ancien_statut, nouveau_statut,
    ancienne_destination_id, nouvelle_destination_id
  ) values (
    new.id, action_evenement, (select auth.uid()), old.statut, new.statut,
    old.destination_id, new.destination_id
  );
  return new;
end;
$$;

create trigger evenement_demande_creation
  after insert on public.demandes_transport
  for each row execute function prive.journaliser_evenement_demande();
create trigger evenement_demande_modification
  after update of statut, destination_id on public.demandes_transport
  for each row execute function prive.journaliser_evenement_demande();

create function prive.mettre_evenement_en_file_courriel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.file_courriels (evenement_demande_id) values (new.id);
  return new;
end;
$$;

create trigger evenement_demande_file_email
  after insert on public.evenements_demande
  for each row execute function prive.mettre_evenement_en_file_courriel();

create function prive.est_jour_ouvre(_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select rc.est_jour_service from public.regles_calendrier rc where rc.date_regle = _date),
    (select extract(isodow from _date)::smallint = any(pa.jours_ouvres)
     from public.parametres_application pa where pa.instance_unique)
  );
$$;

create function public.prochain_jour_ouvre(_depuis date default current_date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _date date := _depuis;
begin
  while not prive.est_jour_ouvre(_date) loop
    _date := _date + 1;
  end loop;
  return _date;
end;
$$;

create function public.preparer_jours_service(_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _jour public.jours_service;
  _nombre integer := 0;
  _capacite integer;
begin
  if (select auth.uid()) is not null and not prive.a_role('gestionnaire') then
    raise exception 'Le role gestionnaire est requis' using errcode = '42501';
  end if;
  if not prive.est_jour_ouvre(_date) then return 0; end if;

  insert into public.jours_service (date_service, vehicule_id)
  select _date, v.id from public.vehicules v where v.est_actif
  on conflict (date_service, vehicule_id) do nothing;

  for _jour in
    select js.* from public.jours_service js
    where js.date_service = _date and js.statut = 'planifie'
  loop
    insert into public.destinations_jour_service (jour_service_id, destination_id, rang_priorite)
    select _jour.id, d.id, d.rang_priorite
    from public.destinations d
    where d.est_actif
    on conflict (jour_service_id, destination_id) do nothing;

    insert into public.demandes_transport (
      jour_service_id, profil_id, date_service, destination_id, origine, statut
    )
    select _jour.id, p.profil_id, _date, destination.id, 'automatique', 'en_attente'
    from public.passagers p
    join public.profils pr on pr.id = p.profil_id and pr.statut_compte = 'actif'
    cross join lateral (
      select djs.destination_id
      from public.destinations_jour_service djs
      left join public.destinations_par_defaut_passager dd
        on dd.destination_id = djs.destination_id and dd.profil_id = p.profil_id
      where djs.jour_service_id = _jour.id
      order by (dd.rang_preference is null), dd.rang_preference, djs.rang_priorite
      limit 1
    ) destination
    where p.categorie = 'titulaire' and p.est_actif
    on conflict (jour_service_id, profil_id) do nothing;

    select v.places_totales into _capacite
    from public.vehicules v where v.id = _jour.vehicule_id;
    with places_libres as (
      select greatest(_capacite - count(*) filter (where dt.statut = 'acceptee'), 0) as nombre
      from public.demandes_transport dt
      where dt.jour_service_id = _jour.id
    ), titulaires_prioritaires as (
      select dt.id
      from public.demandes_transport dt
      join public.passagers p on p.profil_id = dt.profil_id
      where dt.jour_service_id = _jour.id
        and p.categorie = 'titulaire'
        and p.est_actif
        and dt.statut = 'en_attente'
      order by p.rang_priorite, dt.cree_le, dt.id
      limit (select nombre from places_libres)
    )
    update public.demandes_transport dt
    set statut = 'acceptee', decide_le = now(), decide_par = null
    where dt.id in (select tp.id from titulaires_prioritaires tp);
    _nombre := _nombre + 1;
  end loop;

  return _nombre;
end;
$$;

create function public.demander_place(_jour_service_id uuid, _destination_id uuid default null)
returns public.demandes_transport
language plpgsql
security definer
set search_path = ''
as $$
declare
  _demande public.demandes_transport;
  _categorie public.categorie_passager;
  _date date;
  _vehicule_id uuid;
  _statut_jour public.statut_jour_service;
  _fuseau text;
  _heure_limite time;
  _destination uuid := _destination_id;
  _capacite integer;
  _places_occupees integer;
  _titulaires integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  select p.categorie into _categorie
  from public.passagers p join public.profils pr on pr.id = p.profil_id
  where p.profil_id = (select auth.uid()) and p.est_actif and pr.statut_compte = 'actif';
  if not found then raise exception 'Compte passager actif requis' using errcode = '42501'; end if;

  select js.date_service, js.vehicule_id, js.statut
    into _date, _vehicule_id, _statut_jour
  from public.jours_service js where js.id = _jour_service_id for update;
  if not found or _statut_jour <> 'planifie' then
    raise exception 'Journee de service indisponible' using errcode = '22023';
  end if;
  if not prive.est_jour_ouvre(_date) then
    raise exception 'Cette date n est pas un jour de service' using errcode = '22023';
  end if;
  select pa.fuseau_horaire, pa.heure_limite_demande into _fuseau, _heure_limite
  from public.parametres_application pa where pa.instance_unique;
  if (clock_timestamp() at time zone _fuseau)::date > _date
     or ((clock_timestamp() at time zone _fuseau)::date = _date
         and (clock_timestamp() at time zone _fuseau)::time > _heure_limite) then
    raise exception 'Heure limite de demande depassee' using errcode = '22023';
  end if;

  if _destination is null then
    select dd.destination_id into _destination
    from public.destinations_par_defaut_passager dd
    join public.destinations_jour_service djs
      on djs.destination_id = dd.destination_id and djs.jour_service_id = _jour_service_id
    where dd.profil_id = (select auth.uid())
    order by dd.rang_preference limit 1;
  end if;
  if _destination is null then
    select djs.destination_id into _destination
    from public.destinations_jour_service djs
    where djs.jour_service_id = _jour_service_id
    order by djs.rang_priorite limit 1;
  end if;
  if _destination is null or not exists (
    select 1 from public.destinations_jour_service djs
    where djs.jour_service_id = _jour_service_id and djs.destination_id = _destination
  ) then
    raise exception 'Choisissez une destination desservie' using errcode = '22023';
  end if;

  select dt.* into _demande from public.demandes_transport dt
  where dt.jour_service_id = _jour_service_id and dt.profil_id = (select auth.uid());
  if found then
    if _demande.statut = 'refusee' then
      raise exception 'Cette demande a ete refusee' using errcode = '22023';
    end if;
    if _demande.statut = 'annule' then
      update public.demandes_transport
      set statut = 'en_attente', origine = 'manuelle', destination_id = _destination,
          decide_par = null, decide_le = null, note_decision = null
      where id = _demande.id returning * into _demande;
    else
      update public.demandes_transport set destination_id = _destination
      where id = _demande.id returning * into _demande;
    end if;
  else
    insert into public.demandes_transport (
      jour_service_id, profil_id, date_service, destination_id, origine, statut
    ) values (
      _jour_service_id, (select auth.uid()), _date, _destination, 'manuelle', 'en_attente'
    ) returning * into _demande;
  end if;

  if _categorie = 'titulaire' then
    select v.places_totales into _capacite from public.vehicules v where v.id = _vehicule_id;
    select count(*) into _titulaires
    from public.demandes_transport dt join public.passagers p on p.profil_id = dt.profil_id
    where dt.jour_service_id = _jour_service_id and dt.statut <> 'annule'
      and p.categorie = 'titulaire';
    if _titulaires <= _capacite then
      select count(*) into _places_occupees from public.demandes_transport dt
      where dt.jour_service_id = _jour_service_id and dt.statut = 'acceptee';
      if _places_occupees < _capacite then
        update public.demandes_transport
        set statut = 'acceptee', decide_le = now(), decide_par = null
        where id = _demande.id returning * into _demande;
      end if;
    end if;
  end if;
  return _demande;
end;
$$;

create function public.obtenir_disponibilite(_jour_service_id uuid)
returns table (places_totales integer, places_prises bigint, places_libres integer)
language sql
stable
security definer
set search_path = ''
as $$
  select v.places_totales,
         count(dt.id) filter (where dt.statut = 'acceptee'),
         greatest(v.places_totales - count(dt.id) filter (where dt.statut = 'acceptee'), 0)::integer
  from public.jours_service js
  join public.vehicules v on v.id = js.vehicule_id
  left join public.demandes_transport dt on dt.jour_service_id = js.id
  where js.id = _jour_service_id
    and (
      prive.a_role('gestionnaire') or prive.a_role('conducteur') or prive.a_role('passager')
    )
  group by v.places_totales;
$$;

revoke all on function prive.est_jour_ouvre(date) from public;
revoke all on function public.prochain_jour_ouvre(date), public.preparer_jours_service(date),
  public.demander_place(uuid, uuid), public.obtenir_disponibilite(uuid) from public, anon;
grant execute on function public.prochain_jour_ouvre(date), public.demander_place(uuid, uuid),
  public.obtenir_disponibilite(uuid) to authenticated;
grant execute on function public.preparer_jours_service(date) to authenticated;

create function public.lister_conducteurs()
returns table (id uuid, nom_affiche text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.nom_affiche
  from public.profils p
  join public.roles_utilisateur r on r.profil_id = p.id and r.role = 'conducteur'
  where p.statut_compte = 'actif'
    and (prive.a_role('gestionnaire') or prive.a_role('conducteur') or prive.a_role('passager'))
  order by p.nom_affiche;
$$;
revoke all on function public.lister_conducteurs() from public, anon;
grant execute on function public.lister_conducteurs() to authenticated;

create function public.obtenir_manifeste(_jour_service_id uuid)
returns table (profil_id uuid, nom_affiche text, destination text, categorie public.categorie_passager)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not prive.a_role('gestionnaire') and not exists (
    select 1 from public.jours_service js
    where js.id = _jour_service_id and js.conducteur_id = (select auth.uid())
      and prive.a_role('conducteur')
  ) then
    raise exception 'Acces au manifeste refuse' using errcode = '42501';
  end if;
  return query
    select dt.profil_id, p.nom_affiche, d.nom, ps.categorie
    from public.demandes_transport dt
    join public.profils p on p.id = dt.profil_id
    join public.passagers ps on ps.profil_id = dt.profil_id
    join public.destinations d on d.id = dt.destination_id
    where dt.jour_service_id = _jour_service_id and dt.statut = 'acceptee'
    order by d.rang_priorite, ps.rang_priorite, p.nom_affiche;
end;
$$;
revoke all on function public.obtenir_manifeste(uuid) from public, anon;
grant execute on function public.obtenir_manifeste(uuid) to authenticated;

create function public.gestionnaire_decider_demande(_demande_id uuid, _decision public.statut_demande, _note text default null)
returns public.demandes_transport
language plpgsql
security definer
set search_path = ''
as $$
declare
  cible public.demandes_transport;
  vehicule_service uuid;
  statut_jour public.statut_jour_service;
  capacite integer;
  places_occupees integer;
begin
  if not prive.a_role('gestionnaire') then
    raise exception 'Le role gestionnaire est requis' using errcode = '42501';
  end if;
  if _decision not in ('acceptee', 'refusee') then
    raise exception 'La decision doit etre acceptee ou refusee' using errcode = '22023';
  end if;

  select sd.vehicule_id, sd.statut into vehicule_service, statut_jour
  from public.demandes_transport rr
  join public.jours_service sd on sd.id = rr.jour_service_id
  where rr.id = _demande_id
  for update of sd;
  if not found then
    raise exception 'Demande introuvable' using errcode = 'P0002';
  end if;
  if statut_jour <> 'planifie' then
    raise exception 'Cette journee de service est annulee' using errcode = '22023';
  end if;

  select rr.* into cible from public.demandes_transport rr where rr.id = _demande_id for update;
  if cible.statut <> 'en_attente' then
    raise exception 'La demande est deja traitee' using errcode = '22023';
  end if;

  if _decision = 'acceptee' then
    select v.places_totales into capacite from public.vehicules v where v.id = vehicule_service;
    select count(*) into places_occupees
    from public.demandes_transport rr
    where rr.jour_service_id = cible.jour_service_id
      and rr.statut = 'acceptee'
      and rr.id <> cible.id;
    if places_occupees >= capacite then
      raise exception 'Aucune place ne reste pour ce trajet' using errcode = '23514';
    end if;
  end if;

  update public.demandes_transport
  set statut = _decision,
      decide_par = (select auth.uid()),
      decide_le = now(),
      note_decision = _note
  where id = _demande_id
  returning * into cible;
  return cible;
end;
$$;

revoke all on function public.gestionnaire_decider_demande(uuid, public.statut_demande, text) from public, anon;
grant execute on function public.gestionnaire_decider_demande(uuid, public.statut_demande, text) to authenticated;

create function public.definir_demande_active(_demande_id uuid, _actif boolean)
returns public.demandes_transport
language plpgsql
security definer
set search_path = ''
as $$
declare
  cible public.demandes_transport;
  categorie_passager public.categorie_passager;
  vehicule_service uuid;
  statut_service public.statut_jour_service;
  nom_fuseau text;
  heure_limite time;
  capacite integer;
  places_occupees integer;
begin
  select rr.* into cible from public.demandes_transport rr where rr.id = _demande_id;
  if not found then
    raise exception 'Demande introuvable' using errcode = 'P0002';
  end if;
  if cible.profil_id <> (select auth.uid()) then
    raise exception 'La demande doit appartenir au compte connecte' using errcode = '42501';
  end if;

  perform 1 from public.jours_service sd where sd.id = cible.jour_service_id for update;
  select rr.* into cible from public.demandes_transport rr where rr.id = _demande_id for update;

  select p.categorie into categorie_passager
  from public.passagers p
  join public.profils pr on pr.id = p.profil_id
  where p.profil_id = cible.profil_id and p.est_actif and pr.statut_compte = 'actif';
  if not found then
    raise exception 'Un compte passager actif est requis' using errcode = '42501';
  end if;

  select sd.vehicule_id, sd.statut into vehicule_service, statut_service
  from public.jours_service sd
  where sd.id = cible.jour_service_id
  for update;
  if statut_service <> 'planifie' then
    raise exception 'Cette journee de service est annulee' using errcode = '22023';
  end if;
  select s.fuseau_horaire, s.heure_limite_demande into nom_fuseau, heure_limite
  from public.parametres_application s where s.instance_unique;
  if (clock_timestamp() at time zone nom_fuseau)::date > cible.date_service
     or ((clock_timestamp() at time zone nom_fuseau)::date = cible.date_service
         and (clock_timestamp() at time zone nom_fuseau)::time > heure_limite) then
    raise exception 'L heure limite de demande est depassee' using errcode = '22023';
  end if;

  if not _actif then
    if cible.statut not in ('en_attente', 'acceptee') then
      raise exception 'La demande est deja inactive' using errcode = '22023';
    end if;
    update public.demandes_transport
    set statut = 'annule', decide_par = null, decide_le = null, note_decision = null
    where id = _demande_id returning * into cible;
    return cible;
  end if;

  if cible.statut <> 'annule' then
    raise exception 'Seule une demande annulee peut etre reactivee' using errcode = '22023';
  end if;

  if categorie_passager = 'titulaire' then
    select v.places_totales into capacite from public.vehicules v where v.id = vehicule_service;
    select count(*) into places_occupees
    from public.demandes_transport rr
    where rr.jour_service_id = cible.jour_service_id and rr.statut = 'acceptee';
    if places_occupees < capacite then
      update public.demandes_transport
      set statut = 'acceptee', decide_par = null, decide_le = now(), note_decision = null
      where id = _demande_id returning * into cible;
    else
      update public.demandes_transport
      set statut = 'en_attente', decide_par = null, decide_le = null, note_decision = null
      where id = _demande_id returning * into cible;
    end if;
  else
    update public.demandes_transport
    set statut = 'en_attente', decide_par = null, decide_le = null, note_decision = null
    where id = _demande_id returning * into cible;
  end if;
  return cible;
end;
$$;

revoke all on function public.definir_demande_active(uuid, boolean) from public, anon;
grant execute on function public.definir_demande_active(uuid, boolean) to authenticated;

create function public.gestionnaire_valider_passager(_profil_id uuid, _categorie public.categorie_passager, _rang_priorite integer default 100)
returns public.passagers
language plpgsql
security definer
set search_path = ''
as $$
declare
  resultat public.passagers;
begin
  if not prive.a_role('gestionnaire') then
    raise exception 'Le role gestionnaire est requis' using errcode = '42501';
  end if;
  if _rang_priorite < 0 then
    raise exception 'La priorite doit etre positive ou nulle' using errcode = '22023';
  end if;
  update public.profils set statut_compte = 'actif' where id = _profil_id and statut_compte = 'en_attente';
  if not found then
    raise exception 'Profil en attente introuvable' using errcode = 'P0002';
  end if;
  insert into public.passagers (profil_id, categorie, rang_priorite)
  values (_profil_id, _categorie, _rang_priorite)
  returning * into resultat;
  insert into public.roles_utilisateur (profil_id, role) values (_profil_id, 'passager');
  return resultat;
end;
$$;

create function public.gestionnaire_definir_role_utilisateur(_profil_id uuid, _role public.role_application, _actif boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not prive.a_role('gestionnaire') then
    raise exception 'Le role gestionnaire est requis' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profils where id = _profil_id and statut_compte = 'actif') then
    raise exception 'Profil actif introuvable' using errcode = 'P0002';
  end if;
  if _actif then
    insert into public.roles_utilisateur (profil_id, role) values (_profil_id, _role)
    on conflict do nothing;
  else
    delete from public.roles_utilisateur where profil_id = _profil_id and role = _role;
  end if;
end;
$$;

revoke all on function public.gestionnaire_valider_passager(uuid, public.categorie_passager, integer) from public, anon;
revoke all on function public.gestionnaire_definir_role_utilisateur(uuid, public.role_application, boolean) from public, anon;
grant execute on function public.gestionnaire_valider_passager(uuid, public.categorie_passager, integer) to authenticated;
grant execute on function public.gestionnaire_definir_role_utilisateur(uuid, public.role_application, boolean) to authenticated;

alter table public.profils enable row level security;
alter table public.roles_utilisateur enable row level security;
alter table public.passagers enable row level security;
alter table public.destinations enable row level security;
alter table public.destinations_par_defaut_passager enable row level security;
alter table public.vehicules enable row level security;
alter table public.jours_service enable row level security;
alter table public.destinations_jour_service enable row level security;
alter table public.demandes_transport enable row level security;
alter table public.remarques_conducteur enable row level security;
alter table public.evenements_demande enable row level security;
alter table public.file_courriels enable row level security;
alter table public.parametres_application enable row level security;
alter table public.regles_calendrier enable row level security;
alter table public.abonnements_notifications enable row level security;

revoke all on public.profils, public.roles_utilisateur, public.passagers, public.destinations,
  public.destinations_par_defaut_passager, public.vehicules, public.jours_service,
  public.destinations_jour_service, public.demandes_transport, public.remarques_conducteur,
  public.evenements_demande, public.file_courriels, public.parametres_application,
  public.regles_calendrier, public.abonnements_notifications
  from anon, authenticated;
grant select, update on public.profils to authenticated;
grant select on public.roles_utilisateur to authenticated;
grant select on public.passagers, public.destinations, public.destinations_par_defaut_passager,
  public.vehicules, public.jours_service, public.destinations_jour_service,
  public.demandes_transport, public.remarques_conducteur, public.parametres_application, public.regles_calendrier to authenticated;
grant select, insert, update, delete on public.destinations, public.destinations_par_defaut_passager,
  public.vehicules, public.jours_service, public.destinations_jour_service, public.regles_calendrier to authenticated;
grant insert, update on public.passagers to authenticated;
grant update (statut) on public.demandes_transport to authenticated;
grant insert, update on public.remarques_conducteur to authenticated;
grant update on public.parametres_application to authenticated;
grant select, insert, delete on public.abonnements_notifications to authenticated;
grant update on public.abonnements_notifications to authenticated;
grant select on public.evenements_demande to authenticated;
grant usage, select on sequence public.evenements_demande_id_seq to authenticated;

create policy profils_lecture_perso_gestionnaire on public.profils
  for select to authenticated
  using (id = (select auth.uid()) or (select prive.a_role('gestionnaire')));
create policy profils_modification_gestionnaire on public.profils
  for update to authenticated
  using ((select prive.a_role('gestionnaire')))
  with check ((select prive.a_role('gestionnaire')));

create policy roles_lecture_perso_gestionnaire on public.roles_utilisateur
  for select to authenticated
  using (profil_id = (select auth.uid()) or (select prive.a_role('gestionnaire')));

create policy passagers_lecture_autorisee on public.passagers
  for select to authenticated
  using (profil_id = (select auth.uid()) or (select prive.a_role('gestionnaire')) or (select prive.a_role('conducteur')));
create policy passagers_gestion_gestionnaire on public.passagers
  for all to authenticated
  using ((select prive.a_role('gestionnaire')))
  with check ((select prive.a_role('gestionnaire')));

create policy destinations_lecture_actives on public.destinations
  for select to authenticated using (est_actif or (select prive.a_role('gestionnaire')));
create policy destinations_gestion_gestionnaire on public.destinations
  for all to authenticated using ((select prive.a_role('gestionnaire')))
  with check ((select prive.a_role('gestionnaire')));

create policy destinations_defaut_lecture_autorisee on public.destinations_par_defaut_passager
  for select to authenticated
  using (profil_id = (select auth.uid()) or (select prive.a_role('gestionnaire')));
create policy destinations_defaut_gestion_perso_gestionnaire on public.destinations_par_defaut_passager
  for all to authenticated
  using (profil_id = (select auth.uid()) or (select prive.a_role('gestionnaire')))
  with check (profil_id = (select auth.uid()) or (select prive.a_role('gestionnaire')));

create policy vehicules_lecture_actifs on public.vehicules
  for select to authenticated using (est_actif or (select prive.a_role('gestionnaire')));
create policy vehicules_gestion_gestionnaire on public.vehicules
  for all to authenticated using ((select prive.a_role('gestionnaire')))
  with check ((select prive.a_role('gestionnaire')));

create policy jours_service_lecture_authentifie on public.jours_service
  for select to authenticated
  using (
    (select prive.a_role('gestionnaire'))
    or ((select prive.a_role('conducteur')) and conducteur_id = (select auth.uid()))
    or (select prive.a_role('passager'))
  );
create policy jours_service_gestion_gestionnaire on public.jours_service
  for all to authenticated using ((select prive.a_role('gestionnaire')))
  with check ((select prive.a_role('gestionnaire')));

create policy destinations_service_lecture_authentifie on public.destinations_jour_service
  for select to authenticated
  using ((select prive.a_role('gestionnaire')) or (select prive.a_role('conducteur')) or (select prive.a_role('passager')));
create policy destinations_service_gestion_gestionnaire on public.destinations_jour_service
  for all to authenticated using ((select prive.a_role('gestionnaire')))
  with check ((select prive.a_role('gestionnaire')));

create policy demandes_lecture_perso_gestionnaire_conducteur on public.demandes_transport
  for select to authenticated
  using (
    profil_id = (select auth.uid())
    or (select prive.a_role('gestionnaire'))
    or (
      statut = 'acceptee'
      and (select prive.a_role('conducteur'))
      and exists (
        select 1 from public.jours_service sd
        where sd.id = jour_service_id and sd.conducteur_id = (select auth.uid())
      )
    )
  );
create policy demandes_creation_perso_attente on public.demandes_transport
  for insert to authenticated
  with check (
    profil_id = (select auth.uid())
    and statut = 'en_attente'
    and origine = 'manuelle'
    and decide_par is null
    and decide_le is null
  );
create policy demandes_annulation_perso on public.demandes_transport
  for update to authenticated
  using (profil_id = (select auth.uid()) and statut in ('en_attente', 'acceptee'))
  with check (profil_id = (select auth.uid()) and statut = 'annule');

create policy remarques_lecture_auteur_gestionnaire on public.remarques_conducteur
  for select to authenticated
  using (profil_id = (select auth.uid()) or (select prive.a_role('gestionnaire')));
create policy remarques_creation_perso on public.remarques_conducteur
  for insert to authenticated
  with check (
    profil_id = (select auth.uid()) and statut = 'visible'
    and (select prive.profil_a_role(conducteur_id, 'conducteur'))
    and exists (
      select 1
      from public.jours_service js
      join public.demandes_transport dt on dt.jour_service_id = js.id
      where js.id = remarques_conducteur.jour_service_id
        and js.conducteur_id = remarques_conducteur.conducteur_id
        and dt.profil_id = (select auth.uid())
        and dt.statut = 'acceptee'
    )
  );
create policy remarques_retrait_perso_gestionnaire on public.remarques_conducteur
  for update to authenticated
  using (profil_id = (select auth.uid()) or (select prive.a_role('gestionnaire')))
  with check (profil_id = (select auth.uid()) or (select prive.a_role('gestionnaire')));

create policy evenements_lecture_gestionnaire on public.evenements_demande
  for select to authenticated using ((select prive.a_role('gestionnaire')));
create policy parametres_lecture_authentifie on public.parametres_application
  for select to authenticated using (true);
create policy parametres_gestion_gestionnaire on public.parametres_application
  for update to authenticated using ((select prive.a_role('gestionnaire')))
  with check ((select prive.a_role('gestionnaire')));
create policy calendrier_lecture_authentifie on public.regles_calendrier
  for select to authenticated using (true);
create policy calendrier_gestion_gestionnaire on public.regles_calendrier
  for all to authenticated using ((select prive.a_role('gestionnaire')))
  with check ((select prive.a_role('gestionnaire')));

create policy abonnements_notifications_proprietaire on public.abonnements_notifications
  for all to authenticated
  using (profil_id = (select auth.uid()))
  with check (profil_id = (select auth.uid()));

-- La file_courriels est reservee aux Edge Functions utilisant la cle de service.
