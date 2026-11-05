(() => {
  'use strict';
  const choisir = (s, r = document) => r.querySelector(s);
  const echapper = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateAbidjan = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Abidjan' }).format(d);
  const dateLisible = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  let minuteurToast;
  function afficherToast(message, erreur = false) {
    const toast = choisir('#toast'); toast.textContent = message;
    toast.classList.toggle('erreur-toast', erreur); toast.classList.add('visible');
    clearTimeout(minuteurToast); minuteurToast = setTimeout(() => toast.classList.remove('visible'), 3000);
  }
  const configurationValide = window.CONFIG?.SUPABASE_URL && window.CONFIG?.SUPABASE_CLE
    && !window.CONFIG.SUPABASE_URL.includes('VOTRE-PROJET') && !window.CONFIG.SUPABASE_CLE.includes('VOTRE-CLE');
  const base = configurationValide ? window.supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_CLE) : null;
  const etat = { utilisateur: null, profil: null, profils: [], roles: [], tousRoles: [], passagers: [], destinations: [],
    destinationsDefaut: [], vehicules: [], jours: [], destinationsJour: [], demandes: [], remarques: [], conducteurs: [],
    parametres: null, disponibilite: null, jourId: null, onglet: 'demandes', modeInscription: false };
  const resultat = async (requete) => { const reponse = await requete; if (reponse.error) throw reponse.error; return reponse.data; };
  const gestionnaire = () => etat.roles.includes('gestionnaire');
  const conducteur = () => etat.roles.includes('conducteur');
  const profilActif = () => etat.profil?.statut_compte === 'actif';
  const passagerActif = () => etat.passagers.some((p) => p.profil_id === etat.utilisateur?.id && p.est_actif);
  const nomPassager = (id) => etat.profils.find((p) => p.id === id)?.nom_affiche || 'Passager';
  const nomDestination = (id) => etat.destinations.find((d) => d.id === id)?.nom || 'Destination';
  const jourCourant = () => etat.jours.find((j) => j.id === etat.jourId) || null;
  const demandePerso = () => etat.demandes.find((d) => d.profil_id === etat.utilisateur?.id && d.jour_service_id === etat.jourId) || null;
  function afficherEcran(nom) { ['chargement', 'connexion', 'attente', 'app'].forEach((id) => { choisir(`#${id}`).hidden = id !== nom; }); }

  async function chargerDonnees() {
    const [parametres, profils, roles, passagers, destinations, destinationsDefaut, vehicules, jours] = await Promise.all([
      resultat(base.from('parametres_application').select('*').eq('instance_unique', true).single()),
      resultat(base.from('profils').select('id,nom_affiche,courriel,statut_compte').order('nom_affiche')),
      resultat(base.from('roles_utilisateur').select('profil_id,role')),
      resultat(base.from('passagers').select('*')),
      resultat(base.from('destinations').select('*').order('rang_priorite')),
      resultat(base.from('destinations_par_defaut_passager').select('*')),
      resultat(base.from('vehicules').select('*').eq('est_actif', true).order('nom')),
      resultat(base.from('jours_service').select('id,date_service,vehicule_id,conducteur_id,statut,vehicules(nom,places_totales)')
        .gte('date_service', dateAbidjan(new Date())).order('date_service').limit(30)),
    ]);
    etat.parametres = parametres; etat.profils = profils || []; etat.tousRoles = roles || [];
    etat.roles = etat.tousRoles.filter((r) => r.profil_id === etat.utilisateur.id).map((r) => r.role);
    etat.passagers = passagers || []; etat.destinations = destinations || [];
    etat.destinationsDefaut = destinationsDefaut || []; etat.vehicules = vehicules || [];
    etat.jours = (jours || []).filter((j) => j.statut === 'planifie');
    etat.profil = etat.profils.find((p) => p.id === etat.utilisateur.id) || null;
    if (!etat.jours.some((j) => j.id === etat.jourId)) etat.jourId = etat.jours[0]?.id || null;
    etat.conducteurs = await resultat(base.rpc('lister_conducteurs')) || [];
    if (etat.jours.length) {
      const ids = etat.jours.map((j) => j.id);
      [etat.destinationsJour, etat.demandes] = await Promise.all([
        resultat(base.from('destinations_jour_service').select('*').in('jour_service_id', ids)),
        resultat(base.from('demandes_transport').select('*').in('jour_service_id', ids)),
      ]);
    } else { etat.destinationsJour = []; etat.demandes = []; }
    if (!gestionnaire() && etat.roles.includes('conducteur') && etat.jourId
      && etat.jours.find((j) => j.id === etat.jourId)?.conducteur_id === etat.utilisateur.id) {
      const manifeste = await resultat(base.rpc('obtenir_manifeste', { _jour_service_id: etat.jourId }));
      etat.profils = [...etat.profils, ...(manifeste || []).map((p) => ({ id: p.profil_id, nom_affiche: p.nom_affiche }))];
    }
    if (etat.jourId && profilActif()) {
      const dispo = await resultat(base.rpc('obtenir_disponibilite', { _jour_service_id: etat.jourId }));
      etat.disponibilite = Array.isArray(dispo) ? dispo[0] : dispo;
    } else etat.disponibilite = null;
    if (gestionnaire() && etat.onglet === 'remarques') etat.remarques = await resultat(base.from('remarques_conducteur').select('*').order('cree_le', { ascending: false }).limit(200)) || [];
  }

  function selecteurJour() {
    if (!etat.jours.length) return '<div class="carte"><p class="vide">Aucun trajet programmé pour le moment. Contactez le gestionnaire.</p></div>';
    return `<label class="carte formulaire">Journée et véhicule<select id="choix-jour">${etat.jours.map((j) => {
      const v = Array.isArray(j.vehicules) ? j.vehicules[0] : j.vehicules;
      return `<option value="${j.id}" ${j.id === etat.jourId ? 'selected' : ''}>${echapper(dateLisible(j.date_service))} · ${echapper(v?.nom || 'Véhicule')}</option>`;
    }).join('')}</select></label>`;
  }
  function demandesEnAttente() {
    const demandes = etat.demandes.filter((d) => d.statut === 'en_attente').sort((a, b) => {
      const pa = etat.passagers.find((p) => p.profil_id === a.profil_id);
      const pb = etat.passagers.find((p) => p.profil_id === b.profil_id);
      const da = etat.destinations.find((d) => d.id === a.destination_id);
      const db = etat.destinations.find((d) => d.id === b.destination_id);
      return (pa?.rang_priorite ?? 100) - (pb?.rang_priorite ?? 100) || (da?.rang_priorite ?? 100) - (db?.rang_priorite ?? 100);
    });
    return `<div class="carte"><h2>Demandes à décider</h2>${demandes.length ? `<ul class="liste">${demandes.map((d) => {
      const p = etat.passagers.find((x) => x.profil_id === d.profil_id);
      return `<li><span>${echapper(nomPassager(d.profil_id))} · ${echapper(p?.categorie || 'invité')} · ${echapper(nomDestination(d.destination_id))} · priorité ${p?.rang_priorite ?? '—'}</span><span><button class="bouton principal" data-decision="acceptee" data-demande="${d.id}">Accepter</button> <button class="bouton danger" data-decision="refusee" data-demande="${d.id}">Refuser</button></span></li>`;
    }).join('')}</ul>` : '<p class="vide">Aucune demande en attente.</p>'}</div>`;
  }
  function vueDemandes() {
    const jour = jourCourant();
    if (!jour) return `${selecteurJour()}<div class="carte"><h2>Ma demande</h2><p class="vide">Aucun trajet n’est encore programmé pour les prochains jours ouvrés. Dès qu’un trajet sera créé par le gestionnaire, votre demande apparaîtra ici.</p></div>`;
    const vehicule = Array.isArray(jour.vehicules) ? jour.vehicules[0] : jour.vehicules;
    const demande = demandePerso(); const demandeActive = demande && !['annule', 'refusee'].includes(demande.statut);
    const demandeRefusee = demande?.statut === 'refusee';
    const titulaire = etat.passagers.find((p) => p.profil_id === etat.utilisateur?.id)?.categorie === 'titulaire';
    const destinations = etat.destinationsJour.filter((x) => x.jour_service_id === jour.id).sort((a,b) => a.rang_priorite-b.rang_priorite);
    const etats = { acceptee: 'Place confirmée', en_attente: 'En attente de décision du gestionnaire', refusee: 'Demande refusée', annule: 'Demande désactivée' };
    const actionDemande = demandeActive
      ? `<button class="bouton danger" type="button" data-action-demande="desactiver">Désactiver ma demande</button>`
      : demandeRefusee
        ? '<button class="bouton" type="button" disabled>Demande refusée</button>'
        : `<button class="bouton principal" type="button" data-action-demande="activer" ${destinations.length ? '' : 'disabled'}>${demande?.statut === 'annule' ? 'Réactiver ma demande' : 'Envoyer ma demande'}</button>`;
    const instructionDemande = titulaire
      ? 'Votre demande est créée automatiquement chaque jour ouvré. Désactivez-la si vous ne prenez pas le trajet.'
      : 'Choisissez votre destination, puis envoyez votre demande. Le gestionnaire devra confirmer votre place.';
    return `${selecteurJour()}<div class="carte vehicule"><div class="chiffre-places">${etat.disponibilite?.places_libres ?? vehicule?.places_totales ?? 0}<span> place(s) disponible(s) sur ${vehicule?.places_totales ?? 0}</span></div><p class="doux">${echapper(dateLisible(jour.date_service))} · ${echapper(vehicule?.nom || 'Véhicule')}</p></div>
      <div class="carte"><h2>Ma demande</h2><p class="doux">${demande ? etats[demande.statut] || demande.statut : 'Aucune demande enregistrée pour ce trajet.'}</p>
      ${passagerActif() ? `${destinations.length ? `<p>${instructionDemande}</p><label class="formulaire">Destination<select id="choix-destination" ${demandeRefusee ? 'disabled' : ''}>${destinations.map((d) => `<option value="${d.destination_id}" ${d.destination_id === demande?.destination_id ? 'selected' : ''}>${echapper(nomDestination(d.destination_id))}</option>`).join('')}</select></label><div class="actions-demande">${actionDemande}</div>` : '<p class="vide">Les destinations de ce trajet ne sont pas encore configurées. Contactez le gestionnaire.</p>'}` : '<p class="erreur">Votre compte attend la validation du gestionnaire.</p>'}</div>
      ${passagerActif() ? `<label class="formulaire">Mes destinations habituelles<select multiple data-destinations-profil="${etat.utilisateur.id}">${etat.destinations.map((d) => `<option value="${d.id}" ${etat.destinationsDefaut.some((x) => x.profil_id === etat.utilisateur.id && x.destination_id === d.id) ? 'selected' : ''}>${echapper(d.nom)}</option>`).join('')}</select></label>` : ''}
      ${gestionnaire() ? demandesEnAttente() : ''}`;
  }
  function vueTrajet() {
    const jour = jourCourant(); if (!jour) return selecteurJour();
    if (!conducteur() && !gestionnaire()) return '<div class="carte"><p class="vide">Le manifeste est réservé au conducteur et au gestionnaire.</p></div>';
    const admises = etat.demandes.filter((d) => d.jour_service_id === jour.id && d.statut === 'acceptee');
    const destinations = etat.destinationsJour.filter((d) => d.jour_service_id === jour.id).sort((a,b) => a.rang_priorite-b.rang_priorite);
    return `${selecteurJour()}<div class="carte"><h2>Manifeste du ${echapper(dateLisible(jour.date_service))}</h2>${destinations.map((destination) => {
      const liste = admises.filter((d) => d.destination_id === destination.destination_id);
      return liste.length ? `<h3>${echapper(nomDestination(destination.destination_id))}</h3><ul class="liste">${liste.map((d) => `<li>${echapper(nomPassager(d.profil_id))}</li>`).join('')}</ul>` : '';
    }).join('') || '<p class="vide">Aucun passager confirmé.</p>'}</div>`;
  }
  function vueRemarques() {
    const jour = jourCourant();
    const conducteurAffecte = etat.conducteurs.find((c) => c.id === jour?.conducteur_id);
    const formulaire = !conducteur() && jour ? `<form class="carte formulaire" id="form-remarque"><h2>Remarque sur la conduite</h2><p class="doux">Le gestionnaire verra votre nom. Le conducteur ne verra pas cette remarque.</p>
      <label>Conducteur affecté<select name="conducteur_id" required ${conducteurAffecte ? '' : 'disabled'}>${conducteurAffecte ? `<option value="${conducteurAffecte.id}">${echapper(conducteurAffecte.nom_affiche)}</option>` : ''}</select></label>
      <label>Note<select name="note"><option value="">Sans note</option>${[1,2,3,4,5].map((n) => `<option value="${n}">${n} / 5</option>`).join('')}</select></label><label>Remarque<textarea name="texte" required minlength="3"></textarea></label>
      <button class="bouton principal" type="submit" ${conducteurAffecte ? '' : 'disabled'}>Envoyer</button></form>` : '';
    const synthese = new Map();
    for (const remarque of etat.remarques) {
      const groupe = synthese.get(remarque.conducteur_id) || { total: 0, sommeNotes: 0, nombreNotes: 0 };
      groupe.total++;
      if (remarque.note) { groupe.sommeNotes += remarque.note; groupe.nombreNotes++; }
      synthese.set(remarque.conducteur_id, groupe);
    }
    const resume = [...synthese].map(([id, groupe]) => `<li><strong>${echapper(nomPassager(id))}</strong> · ${groupe.total} remarque(s)${groupe.nombreNotes ? ` · moyenne ${ (groupe.sommeNotes / groupe.nombreNotes).toFixed(1)}/5` : ''}</li>`).join('');
    const liste = gestionnaire() ? `<div class="carte"><h2>Synthèse des remarques</h2>${resume ? `<ul class="liste">${resume}</ul>` : '<p class="vide">Aucune remarque.</p>'}${etat.remarques.map((r) => `<article class="remarque"><p class="doux">${echapper(nomPassager(r.profil_id))} · ${echapper(nomPassager(r.conducteur_id))} · ${new Date(r.cree_le).toLocaleDateString('fr-FR')}${r.note ? ` · ${r.note}/5` : ''}</p><p>${echapper(r.texte)}</p></article>`).join('')}</div>` : '';
    return `${selecteurJour()}${formulaire}${liste}`;
  }
  function vueGestion() {
    const enAttente = etat.profils.filter((p) => p.statut_compte === 'en_attente');
    return `<div class="carte"><h2>Comptes à valider</h2>${enAttente.length ? `<ul class="liste">${enAttente.map((p) => `<li>${echapper(p.nom_affiche || p.courriel || 'Nouveau compte')} · ${echapper(p.courriel || '')}<span><button class="bouton principal" data-valider="${p.id}" data-categorie="invite">Valider comme invité</button> <button class="bouton" data-valider="${p.id}" data-categorie="titulaire">Comme titulaire</button></span></li>`).join('')}</ul>` : '<p class="vide">Aucun compte en attente.</p>'}</div>
      <div class="carte"><h2>Véhicules</h2><form id="form-vehicule" class="formulaire grille-2"><label>Nom<input name="nom" required></label><label>Places<input name="places_totales" type="number" min="1" required></label><button class="bouton principal">Ajouter</button></form>${etat.vehicules.map((v) => `<p>${echapper(v.nom)} — <input type="number" min="1" data-places-vehicule="${v.id}" value="${v.places_totales}"> places</p>`).join('')}</div>
      <div class="carte"><h2>Conducteurs et trajets</h2><ul class="liste">${etat.jours.map((j) => `<li>${echapper(dateLisible(j.date_service))} · ${echapper((Array.isArray(j.vehicules) ? j.vehicules[0] : j.vehicules)?.nom || 'Véhicule')}<label>Conducteur<select data-conducteur-jour="${j.id}"><option value="">À attribuer</option>${etat.conducteurs.map((c) => `<option value="${c.id}" ${c.id === j.conducteur_id ? 'selected' : ''}>${echapper(c.nom_affiche)}</option>`).join('')}</select></label></li>`).join('') || '<li>Aucun trajet généré.</li>'}</ul></div>
      <div class="carte"><h2>Destinations</h2><p class="doux">Un rang plus petit signifie une priorité plus élevée.</p><form id="form-destination" class="formulaire grille-2"><label>Nom<input name="nom" required></label><label>Priorité<input name="rang_priorite" type="number" min="0" value="100" required></label><button class="bouton principal">Ajouter</button></form><ul class="liste">${etat.destinations.map((d) => `<li>${echapper(d.nom)} <label>Priorité<input type="number" min="0" data-priorite-destination="${d.id}" value="${d.rang_priorite}"></label></li>`).join('')}</ul></div>
      <div class="carte"><h2>Paramètres</h2><form id="form-parametres" class="formulaire grille-2"><label>Adresse du gestionnaire<input type="email" name="courriel_gestionnaire" value="${echapper(etat.parametres?.courriel_gestionnaire || '')}" required></label><label>Heure limite<input type="time" name="heure_limite_demande" value="${etat.parametres?.heure_limite_demande || '16:30'}" required></label><button class="bouton principal">Enregistrer</button></form></div>
      <div class="carte"><h2>Passagers</h2><ul class="liste">${etat.passagers.map((p) => `<li>${echapper(nomPassager(p.profil_id))} · ${echapper(p.categorie)} <label>Priorité<input type="number" min="0" data-priorite-passager="${p.profil_id}" value="${p.rang_priorite}"></label><label>Conducteur<input type="checkbox" data-role-conducteur="${p.profil_id}" ${etat.tousRoles.some((r) => r.profil_id === p.profil_id && r.role === 'conducteur') ? 'checked' : ''}></label><label>Destinations habituelles<select multiple data-destinations-profil="${p.profil_id}">${etat.destinations.map((d) => `<option value="${d.id}" ${etat.destinationsDefaut.some((x) => x.profil_id === p.profil_id && x.destination_id === d.id) ? 'selected' : ''}>${echapper(d.nom)}</option>`).join('')}</select></label><label>Actif<input type="checkbox" data-passager-actif="${p.profil_id}" ${p.est_actif ? 'checked' : ''}></label></li>`).join('')}</ul></div>`;
  }
  function ongletsDisponibles() {
    if (!profilActif()) return [];
    const onglets = [];
    if (passagerActif() && !conducteur()) onglets.push(['demandes', 'Ma demande']);
    if (conducteur() || gestionnaire()) onglets.push(['trajet', 'Manifeste']);
    if (!conducteur()) onglets.push(['remarques', 'Remarques']);
    if (gestionnaire()) onglets.push(['gestion', 'Gestion']);
    return onglets;
  }
  function rendre() {
    if (!etat.profil) return;
    afficherEcran('app'); choisir('#utilisateur').textContent = etat.profil.nom_affiche || etat.profil.courriel || 'Gestiga';
    choisir('#btn-rappels').hidden = !profilActif();
    if (!profilActif()) {
      choisir('#nav').innerHTML = '';
      choisir('#vue').innerHTML = '<div class="carte"><h1>Compte en attente</h1><p>Le gestionnaire doit valider votre inscription.</p></div>';
      return;
    }
    const onglets = ongletsDisponibles();
    if (!onglets.length) { choisir('#vue').innerHTML = '<div class="carte"><p>Votre compte ne possède pas encore de rôle actif. Contactez le gestionnaire.</p></div>'; return; }
    if (!onglets.some(([id]) => id === etat.onglet)) etat.onglet = onglets[0][0];
    choisir('#nav').innerHTML = onglets.map(([id, nom]) => `<button data-onglet="${id}" ${id === etat.onglet ? 'aria-current="page"' : ''}>${nom}</button>`).join('');
    choisir('#vue').innerHTML = ({ demandes: vueDemandes, trajet: vueTrajet, remarques: vueRemarques, gestion: vueGestion })[etat.onglet]();
  }
  async function actualiser() {
    try {
      await chargerDonnees();
      if (etat.profil?.statut_compte === 'en_attente') afficherEcran('attente');
      else rendre();
    }
    catch (erreur) { afficherToast(`Chargement impossible : ${erreur.message}`, true); }
  }
  async function demanderPlace() {
    const jour = jourCourant(); if (!jour) return afficherToast('Aucun trajet n’est programmé.', true);
    const destination = choisir('#choix-destination')?.value || null;
    const { error: erreur } = await base.rpc('demander_place', { _jour_service_id: jour.id, _destination_id: destination });
    if (erreur) return afficherToast(erreur.message, true);
    afficherToast('Demande enregistrée.'); await actualiser();
  }
  async function changerDemande(estActive) {
    const demande = demandePerso();
    if (estActive) return demanderPlace();
    if (!demande) return;
    const { error: erreur } = await base.rpc('definir_demande_active', { _demande_id: demande.id, _actif: false });
    if (erreur) return afficherToast(erreur.message, true);
    afficherToast('Demande désactivée.'); await actualiser();
  }
  async function traiterChangement(cible) {
    if (cible.id === 'choix-jour') { etat.jourId = cible.value; await actualiser(); return; }
    if (cible.id === 'demande-active') { await changerDemande(cible.checked); return; }
    if (cible.id === 'choix-destination') { if (demandePerso() && demandePerso().statut !== 'annule') await demanderPlace(); return; }
    if (cible.dataset.actionDemande) { await changerDemande(cible.dataset.actionDemande === 'activer'); return; }
    if (cible.dataset.decision) {
      const { error: erreur } = await base.rpc('gestionnaire_decider_demande', { _demande_id: cible.dataset.demande, _decision: cible.dataset.decision, _note: null });
      if (erreur) throw erreur; afficherToast('Décision enregistrée.'); await actualiser(); return;
    }
    if (cible.dataset.valider) {
      const { error: erreur } = await base.rpc('gestionnaire_valider_passager', { _profil_id: cible.dataset.valider, _categorie: cible.dataset.categorie, _rang_priorite: 100 });
      if (erreur) throw erreur; afficherToast('Compte validé.'); await actualiser(); return;
    }
    if (cible.dataset.prioriteDestination) {
      const { error: erreur } = await base.from('destinations').update({ rang_priorite: Number(cible.value) }).eq('id', cible.dataset.prioriteDestination);
      if (erreur) throw erreur; await actualiser(); return;
    }
    if (cible.dataset.placesVehicule) {
      const { error: erreur } = await base.from('vehicules').update({ places_totales: Number(cible.value) }).eq('id', cible.dataset.placesVehicule);
      if (erreur) throw erreur; await actualiser(); return;
    }
    if (cible.dataset.conducteurJour) {
      const { error: erreur } = await base.from('jours_service').update({ conducteur_id: cible.value || null }).eq('id', cible.dataset.conducteurJour);
      if (erreur) throw erreur; afficherToast('Conducteur affecté.'); await actualiser(); return;
    }
    if (cible.dataset.prioritePassager) {
      const { error: erreur } = await base.from('passagers').update({ rang_priorite: Number(cible.value) }).eq('profil_id', cible.dataset.prioritePassager);
      if (erreur) throw erreur; await actualiser(); return;
    }
    if (cible.dataset.passagerActif) {
      const { error: erreur } = await base.from('passagers').update({ est_actif: cible.checked }).eq('profil_id', cible.dataset.passagerActif);
      if (erreur) throw erreur; await actualiser();
    }
    if (cible.dataset.roleConducteur) {
      const { error: erreur } = await base.rpc('gestionnaire_definir_role_utilisateur', { _profil_id: cible.dataset.roleConducteur, _role: 'conducteur', _actif: cible.checked });
      if (erreur) throw erreur; await actualiser();
    }
    if (cible.dataset.destinationsProfil) {
      const profilId = cible.dataset.destinationsProfil;
      const { error: erreurSuppression } = await base.from('destinations_par_defaut_passager').delete().eq('profil_id', profilId);
      if (erreurSuppression) throw erreurSuppression;
      const lignes = [...cible.selectedOptions].map((option, rang) => ({ profil_id: profilId, destination_id: option.value, rang_preference: rang + 1 }));
      if (lignes.length) { const { error: erreur } = await base.from('destinations_par_defaut_passager').insert(lignes); if (erreur) throw erreur; }
      afficherToast('Destinations habituelles mises à jour.'); await actualiser();
    }
  }
  async function traiterFormulaire(formulaire) {
    const donnees = new FormData(formulaire);
    if (formulaire.id === 'form-remarque') {
      const jour = jourCourant();
      const { error: erreur } = await base.from('remarques_conducteur').insert({
        jour_service_id: jour.id, profil_id: etat.utilisateur.id, conducteur_id: donnees.get('conducteur_id'),
        note: donnees.get('note') ? Number(donnees.get('note')) : null, texte: donnees.get('texte').trim(),
      });
      if (erreur) throw erreur; formulaire.reset(); afficherToast('Remarque envoyée.');
    } else if (formulaire.id === 'form-destination') {
      const { error: erreur } = await base.from('destinations').insert({ nom: donnees.get('nom').trim(), rang_priorite: Number(donnees.get('rang_priorite')) });
      if (erreur) throw erreur;
      const { error: erreurPlanning } = await base.rpc('preparer_jours_service');
      if (erreurPlanning) throw erreurPlanning; afficherToast('Destination ajoutée.');
    } else if (formulaire.id === 'form-vehicule') {
      const { error: erreur } = await base.from('vehicules').insert({ nom: donnees.get('nom').trim(), places_totales: Number(donnees.get('places_totales')) });
      if (erreur) throw erreur;
      const { error: erreurPlanning } = await base.rpc('preparer_jours_service');
      if (erreurPlanning) throw erreurPlanning; afficherToast('Véhicule ajouté.');
    } else if (formulaire.id === 'form-parametres') {
      const { error: erreur } = await base.from('parametres_application').update({
        courriel_gestionnaire: donnees.get('courriel_gestionnaire').trim(), heure_limite_demande: donnees.get('heure_limite_demande'),
      }).eq('instance_unique', true);
      if (erreur) throw erreur; afficherToast('Paramètres enregistrés.');
    }
    await actualiser();
  }
  function brancherActions() {
    choisir('#nav').addEventListener('click', async (evenement) => {
      const bouton = evenement.target.closest('[data-onglet]'); if (!bouton) return;
      etat.onglet = bouton.dataset.onglet;
      if (etat.onglet === 'remarques' && gestionnaire()) etat.remarques = await resultat(base.from('remarques_conducteur').select('*').order('cree_le', { ascending: false }).limit(200)) || [];
      rendre();
    });
    choisir('#vue').addEventListener('change', async (evenement) => {
      try { await traiterChangement(evenement.target); }
      catch (erreur) { afficherToast(erreur.message, true); await actualiser(); }
    });
    choisir('#vue').addEventListener('click', async (evenement) => {
      const bouton = evenement.target.closest('[data-decision], [data-valider], [data-action-demande]');
      if (!bouton) return;
      try { await traiterChangement(bouton); }
      catch (erreur) { afficherToast(erreur.message, true); await actualiser(); }
    });
    choisir('#vue').addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      try { await traiterFormulaire(evenement.target); }
      catch (erreur) { afficherToast(erreur.message, true); }
    });
  }

  function decoderCleVapid(cle) {
    const remplissage = '='.repeat((4 - cle.length % 4) % 4);
    return Uint8Array.from(atob((cle + remplissage).replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
  }
  async function activerRappels() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.CONFIG.CLE_VAPID_PUBLIQUE) return afficherToast('Les notifications ne sont pas disponibles ici.', true);
    const autorisation = await Notification.requestPermission();
    if (autorisation !== 'granted') return afficherToast('Autorisez les notifications pour recevoir les rappels.', true);
    const enregistrement = await navigator.serviceWorker.ready;
    const abonnement = await enregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decoderCleVapid(window.CONFIG.CLE_VAPID_PUBLIQUE) });
    const { error: erreur } = await base.from('abonnements_notifications').upsert({ profil_id: etat.utilisateur.id, point_acces: abonnement.endpoint, cles: abonnement.toJSON().keys }, { onConflict: 'point_acces' });
    if (erreur) throw erreur; afficherToast('Rappels activés sur cet appareil.');
  }
  function brancherPwa() {
    let invitation = null; const bouton = choisir('#btn-installer');
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const dejaInstallee = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (ios && !dejaInstallee) {
      bouton.hidden = false;
      bouton.addEventListener('click', () => afficherToast('Sur iPhone : touchez Partager, puis « Sur l’écran d’accueil ».'));
    }
    window.addEventListener('beforeinstallprompt', (evenement) => { evenement.preventDefault(); invitation = evenement; bouton.hidden = false; });
    window.addEventListener('appinstalled', () => { bouton.hidden = true; afficherToast('Gestiga est installée.'); });
    bouton.addEventListener('click', async () => { if (invitation) { await invitation.prompt(); await invitation.userChoice; invitation = null; bouton.hidden = true; } });
    choisir('#btn-rappels').addEventListener('click', () => activerRappels().catch((erreur) => afficherToast(erreur.message, true)));
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  function actualiserFormulaireConnexion() {
    choisir('#champ-nom').hidden = !etat.modeInscription;
    choisir('#btn-connexion').textContent = etat.modeInscription ? 'Créer mon compte' : 'Se connecter';
    choisir('#btn-bascule').textContent = etat.modeInscription ? 'Déjà un compte ? Se connecter' : 'Pas de compte ? Créer un compte';
    choisir('#form-connexion').elements.mot_de_passe.autocomplete = etat.modeInscription ? 'new-password' : 'current-password';
  }
  function brancherConnexion() {
    choisir('#btn-bascule').addEventListener('click', () => { etat.modeInscription = !etat.modeInscription; choisir('#erreur-connexion').hidden = true; actualiserFormulaireConnexion(); });
    choisir('#form-connexion').addEventListener('submit', async (evenement) => {
      evenement.preventDefault(); const f = evenement.target; const zoneErreur = choisir('#erreur-connexion'); const bouton = choisir('#btn-connexion');
      bouton.disabled = true; zoneErreur.hidden = true;
      try {
        if (etat.modeInscription) {
          const { data: donnees, error: erreurInscription } = await base.auth.signUp({ email: f.elements.courriel.value.trim(), password: f.elements.mot_de_passe.value, options: { data: { nom_affiche: f.elements.nom_affiche.value.trim() } } });
          if (erreurInscription) throw erreurInscription;
          if (!donnees.session) { zoneErreur.textContent = 'Compte créé. Confirmez votre adresse e-mail et attendez la validation du gestionnaire.'; zoneErreur.hidden = false; etat.modeInscription = false; actualiserFormulaireConnexion(); }
        } else {
          const { error: erreurConnexion } = await base.auth.signInWithPassword({ email: f.elements.courriel.value.trim(), password: f.elements.mot_de_passe.value }); if (erreurConnexion) throw erreurConnexion;
        }
      } catch (erreurAuth) { zoneErreur.textContent = erreurAuth.message === 'Invalid login credentials' ? 'E-mail ou mot de passe incorrect.' : erreurAuth.message; zoneErreur.hidden = false; }
      finally { bouton.disabled = false; }
    });
  }
  async function ouvrirSession(utilisateur) {
    etat.utilisateur = utilisateur;
    try {
      await chargerDonnees(); if (!etat.profil) throw new Error('Profil introuvable. Appliquez les migrations Supabase.');
      if (etat.profil.statut_compte === 'en_attente') afficherEcran('attente'); else { afficherEcran('app'); rendre(); }
    } catch (erreurSession) { afficherEcran('connexion'); choisir('#erreur-connexion').textContent = erreurSession.message; choisir('#erreur-connexion').hidden = false; }
  }
  async function demarrer() {
    if (!configurationValide) { afficherEcran('connexion'); choisir('#erreur-connexion').textContent = 'Renseignez les clés Supabase dans config.js.'; choisir('#erreur-connexion').hidden = false; choisir('#btn-connexion').disabled = true; return; }
    brancherConnexion(); brancherPwa(); brancherActions();
    choisir('#btn-deconnexion').addEventListener('click', () => base.auth.signOut());
    choisir('#btn-deconnexion-attente').addEventListener('click', () => base.auth.signOut());
    base.auth.onAuthStateChange((evenement, session) => {
      if (evenement === 'SIGNED_OUT' || !session) { etat.utilisateur = null; etat.profil = null; etat.roles = []; afficherEcran('connexion'); }
      else if (session.user.id !== etat.utilisateur?.id) setTimeout(() => ouvrirSession(session.user), 0);
    });
    setInterval(() => { if (etat.utilisateur && !document.hidden) actualiser(); }, 30000);
  }
  demarrer();
})();
