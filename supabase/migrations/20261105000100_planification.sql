-- Gestiga : taches planifiees et appels aux fonctions hebergees.
-- Le fuseau Afrique/Abidjan est UTC ; les horaires ci-dessous sont donc locaux.
-- Secrets a definir dans Supabase Vault : url_projet et cle_service.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

create function prive.appeler_fonction_hebergee(_nom text, _corps jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _url text := (select vs.decrypted_secret from vault.decrypted_secrets vs where vs.name = 'url_projet');
  _cle text := (select vs.decrypted_secret from vault.decrypted_secrets vs where vs.name = 'cle_service');
begin
  if _url is null or _cle is null then
    raise warning 'Les secrets url_projet ou cle_service sont absents de Vault';
    return;
  end if;
  perform net.http_post(
    url := _url || '/functions/v1/' || _nom,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _cle
    ),
    body := _corps
  );
end;
$$;

revoke all on function prive.appeler_fonction_hebergee(text, jsonb) from public, anon, authenticated;
grant execute on function public.prochain_jour_ouvre(date) to service_role;

create function prive.notifier_mouvements_gestionnaire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform prive.appeler_fonction_hebergee('notifier-gestionnaire');
  return null;
end;
$$;

create trigger apres_evenement_demande_notifier
  after insert on public.evenements_demande
  for each statement execute function prive.notifier_mouvements_gestionnaire();

-- Reprend les courriels restes en file apres une interruption Resend.
select cron.schedule(
  'gestiga-reprise-file-courriels',
  '*/15 * * * *',
  $$ select prive.appeler_fonction_hebergee('notifier-gestionnaire'); $$
);

-- Cree les jours de service et les demandes automatiques des titulaires.
select cron.schedule(
  'gestiga-preparer-service',
  '5 0 * * 1-5',
  $$ select public.preparer_jours_service(current_date); $$
);

-- Les rappels sont envoyes aux titulaires et aux invites a ces deux heures.
select cron.schedule(
  'gestiga-rappel-midi',
  '5 12 * * 1-5',
  $$ select prive.appeler_fonction_hebergee('envoyer-rappels', '{"creneau":"midi"}'::jsonb); $$
);
select cron.schedule(
  'gestiga-rappel-apres-midi',
  '5 16 * * 1-5',
  $$ select prive.appeler_fonction_hebergee('envoyer-rappels', '{"creneau":"apres-midi"}'::jsonb); $$
);
