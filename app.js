(() => {
  'use strict';

  /* ================= Utilitaires ================= */
  const $ = (sel, racine = document) => racine.querySelector(sel);
  const echapper = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iso = (d) => d.toLocaleDateString('sv-SE');

  function joursOuvres(n = 5) {
    const liste = [];
    const d = new Date();
    while (liste.length < n) {
      const j = d.getDay();
      if (j !== 0 && j !== 6) liste.push(iso(d));
      d.setDate(d.getDate() + 1);
    }
    return liste;
  }
  const dateDe = (jour) => new Date(jour + 'T12:00:00');
  const libelleCourt = (jour) => dateDe(jour).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
  const libelleLong = (jour) => dateDe(jour).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const numeroJour = (jour) => dateDe(jour).getDate();

  let minuteurToast;
  function afficherToast(message, erreur = false) {
    const t = $('#toast');
    t.textContent = message;
    t.classList.toggle('erreur-toast', erreur);
    t.classList.add('visible');
    clearTimeout(minuteurToast);
    minuteurToast = setTimeout(() => t.classList.remove('visible'), 2800);
  }

  /* ================= Supabase ================= */
  const configOk = window.CONFIG && CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes('VOTRE-PROJET');
  const bd = configOk ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_CLE) : null;

  /* ================= État ================= */
  const etat = {
    idUtilisateur: null,
    profil: null,
    profils: [],
    destinations: [],
    parametres: { places_total: 8, statut: '' },
    demandes: [],
    remarques: [],
    jours: joursOuvres(5),
    jour: null,
    onglet: 'demandes',
    modeInscription: false,
  };
  etat.jour = etat.jours[0];

  const estGestionnaire = () => etat.profil?.role === 'gestionnaire';
  const estConducteur = () => etat.profil?.role === 'conducteur';
  const nomAffiche = (p) => p.nom || p.email || 'Sans nom';

  /* ================= Chargement des données ================= */
  async function chargerTout() {
    const [p, d, pa, de] = await Promise.all([
      bd.from('profils').select('*').order('nom'),
      bd.from('destinations').select('*').order('priorite'),
      bd.from('parametres').select('*').eq('id', 1).single(),
      bd.from('demandes').select('*').in('jour', etat.jours),
    ]);
    const echec = [p, d, pa, de].find((r) => r.error);
    if (echec) throw echec.error;
    etat.profils = p.data;
    etat.destinations = d.data;
    etat.parametres = pa.data;
    etat.demandes = de.data;
    etat.profil = etat.profils.find((x) => x.id === etat.idUtilisateur) || null;
  }

  async function rechargerDemandes() {
    const { data, error } = await bd.from('demandes').select('*').in('jour', etat.jours);
    if (!error) { etat.demandes = data; rendre(); }
  }

  async function chargerRemarques() {
    if (!estGestionnaire()) return;
    const { data, error } = await bd.from('remarques').select('note, contenu, cree_le').order('cree_le', { ascending: false }).limit(200);
    if (!error) etat.remarques = data;
  }

  /* ================= Calcul des places ================= */
  function calculerJour(jour) {
    const parProfil = new Map(etat.demandes.filter((d) => d.jour === jour).map((d) => [d.profil_id, d]));
    const liste = etat.profils
      .filter((p) => p.actif && p.role !== 'conducteur')
      .map((p) => {
        const d = parProfil.get(p.id);
        const titulaire = p.statut === 'titulaire';
        const active = d ? d.active : titulaire; // titulaire : demande automatique
        const destination_id = d?.destination_id ?? p.destination_id ?? null;
        return { profil: p, titulaire, active, destination_id, accepte: false };
      });

    const titulaires = liste.filter((x) => x.active && x.titulaire);
    titulaires.forEach((x) => (x.accepte = true));
    let restantes = Math.max(0, etat.parametres.places_total - titulaires.length);

    const invites = liste.filter((x) => x.active && !x.titulaire).sort((a, b) => a.profil.priorite - b.profil.priorite);
    let invitesAcceptes = 0;
    invites.forEach((x) => {
      if (restantes > 0) { x.accepte = true; restantes--; invitesAcceptes++; }
    });

    return {
      liste,
      total: etat.parametres.places_total,
      nbTitulaires: titulaires.length,
      nbInvites: invitesAcceptes,
      libres: restantes,
    };
  }

  /* ================= Vues ================= */
  function selecteurJour() {
    return `<div class="jours" role="group" aria-label="Choisir le jour">${etat.jours
      .map((j) => `<button class="jour" data-jour="${j}" aria-pressed="${j === etat.jour}"><small>${libelleCourt(j)}</small><strong>${numeroJour(j)}</strong></button>`)
      .join('')}</div>`;
  }

  function vueDemandes() {
    const c = calculerJour(etat.jour);
    const moi = c.liste.find((x) => x.profil.id === etat.profil.id);
    const sieges = Array.from({ length: c.total }, (_, i) => {
      const classe = i < c.nbTitulaires ? 'titulaire' : i < c.nbTitulaires + c.nbInvites ? 'invite' : '';
      return `<span class="siege ${classe}"></span>`;
    }).join('');

    let blocMoi = '<div class="carte"><p class="vide">Votre profil est désactivé. Contactez le gestionnaire.</p></div>';
    if (moi) {
      let badge, texte;
      if (!moi.active) { badge = '<span class="badge">Désactivée</span>'; texte = moi.titulaire ? 'Votre place est libérée pour ce jour.' : 'Activez pour demander une place.'; }
      else if (moi.titulaire) { badge = '<span class="badge ok">Place garantie</span>'; texte = 'Décochez pour libérer votre place.'; }
      else if (moi.accepte) { badge = '<span class="badge ok">Acceptée</span>'; texte = 'Votre place est confirmée.'; }
      else { badge = '<span class="badge attente">En attente</span>'; texte = 'Vous serez accepté si une place se libère.'; }

      blocMoi = `
        <div class="carte">
          <div class="statut-moi">
            <div>
              <h2>${moi.titulaire ? 'Je voyage ce jour-là' : 'Je demande une place'}</h2>
              <p class="doux">${texte}</p>
            </div>
            <label class="interrupteur" aria-label="Ma demande pour ${libelleLong(etat.jour)}">
              <input type="checkbox" id="chk-demande" ${moi.active ? 'checked' : ''}><span></span>
            </label>
          </div>
          <div>${badge}</div>
          <label class="formulaire">Destination
            <select id="sel-destination">
              <option value="">— À préciser —</option>
              ${etat.destinations.map((d) => `<option value="${d.id}" ${d.id === moi.destination_id ? 'selected' : ''}>${echapper(d.nom)}</option>`).join('')}
            </select>
          </label>
        </div>`;
    }

    const actifs = c.liste
      .filter((x) => x.active)
      .sort((a, b) => (b.accepte - a.accepte) || (b.titulaire - a.titulaire) || (a.profil.priorite - b.profil.priorite));

    return `
      ${selecteurJour()}
      <div class="carte vehicule">
        <div class="rangee">
          <div>
            <div class="chiffre-places">${c.libres}<span>place${c.libres > 1 ? 's' : ''} libre${c.libres > 1 ? 's' : ''} sur ${c.total}</span></div>
            <p class="doux" style="margin-top:.35rem">${echapper(libelleLong(etat.jour))}${etat.parametres.statut ? ' · ' + echapper(etat.parametres.statut) : ''}</p>
          </div>
        </div>
        <div class="sieges" aria-hidden="true">${sieges}</div>
        <div class="legende">
          <span><i style="background:var(--petrole)"></i>Titulaires (${c.nbTitulaires})</span>
          <span><i style="background:var(--signal)"></i>Invités (${c.nbInvites})</span>
          <span><i style="border:2px dashed var(--bord)"></i>Libres</span>
        </div>
      </div>
      ${blocMoi}
      <div class="carte">
        <h3>Passagers du jour</h3>
        ${actifs.length ? `<ul class="liste">${actifs.map((x) => `
          <li>
            <div>${echapper(nomAffiche(x.profil))}<div class="sous">${echapper(nomDestination(x.destination_id))}</div></div>
            <span>${x.titulaire ? '<span class="badge titulaire">Titulaire</span>' : x.accepte ? '<span class="badge ok">Invité accepté</span>' : '<span class="badge attente">En attente</span>'}</span>
          </li>`).join('')}</ul>` : '<p class="vide">Aucune demande pour ce jour.</p>'}
      </div>`;
  }

  function nomDestination(id) {
    return etat.destinations.find((d) => d.id === id)?.nom || 'Destination à préciser';
  }

  function vueTrajet() {
    const c = calculerJour(etat.jour);
    const acceptes = c.liste.filter((x) => x.active && x.accepte);
    const groupes = [...etat.destinations, { id: null, nom: 'Destination à préciser' }]
      .map((d) => ({
        destination: d,
        passagers: acceptes
          .filter((x) => x.destination_id === d.id)
          .sort((a, b) => (b.titulaire - a.titulaire) || (a.profil.priorite - b.profil.priorite)),
      }))
      .filter((g) => g.passagers.length);

    return `
      ${selecteurJour()}
      <div class="carte">
        <h2>Trajet du ${echapper(libelleLong(etat.jour))}</h2>
        <p class="doux">${acceptes.length} passager${acceptes.length > 1 ? 's' : ''} sur ${c.total} places.</p>
      </div>
      ${groupes.length ? groupes.map((g) => `
        <div class="carte">
          <h3>${echapper(g.destination.nom)}</h3>
          <ul class="liste">${g.passagers.map((x) => `
            <li><span>${echapper(nomAffiche(x.profil))}</span>
            ${x.titulaire ? '<span class="badge titulaire">Titulaire</span>' : '<span class="badge">Invité</span>'}</li>`).join('')}
          </ul>
        </div>`).join('') : '<div class="carte"><p class="vide">Aucun passager accepté pour ce jour.</p></div>'}`;
  }

  function vueRemarques() {
    const formulaire = `
      <form class="carte formulaire" id="form-remarque">
        <h2>Une remarque sur la conduite ?</h2>
        <p class="doux">Votre message est lu par le gestionnaire uniquement. Le conducteur n’y a pas accès.</p>
        <div>
          <div class="doux" style="margin-bottom:.3rem">Votre ressenti</div>
          <div class="etoiles" id="etoiles" role="radiogroup" aria-label="Note de 1 à 5">
            ${[1, 2, 3, 4, 5].map((n) => `<input type="radio" name="note" id="note${n}" value="${n}"><label for="note${n}" data-n="${n}" title="${n} sur 5">★</label>`).join('')}
          </div>
        </div>
        <label>Votre remarque
          <textarea name="contenu" required placeholder="Ce qui s’est bien passé, ce qui pourrait être amélioré…"></textarea>
        </label>
        <button class="bouton principal" type="submit">Envoyer la remarque</button>
      </form>`;

    let synthese = '';
    if (estGestionnaire()) {
      const r = etat.remarques;
      const notees = r.filter((x) => x.note);
      const moyenne = notees.length ? (notees.reduce((s, x) => s + x.note, 0) / notees.length).toFixed(1) : '–';
      const repartition = [5, 4, 3, 2, 1].map((n) => {
        const nb = notees.filter((x) => x.note === n).length;
        const pct = notees.length ? Math.round((nb / notees.length) * 100) : 0;
        return `<div class="ligne-note"><span>${n} ★</span><div class="barre"><div style="width:${pct}%"></div></div><span>${nb}</span></div>`;
      }).join('');
      synthese = `
        <div class="carte">
          <h2>Synthèse des remarques</h2>
          <div class="rangee"><div class="chiffre-places">${moyenne}<span>/ 5 · ${r.length} remarque${r.length > 1 ? 's' : ''}</span></div></div>
          <div style="display:grid;gap:.4rem">${repartition}</div>
        </div>
        <div class="carte">
          <h3>Dernières remarques (anonymes)</h3>
          ${r.length ? r.slice(0, 30).map((x) => `
            <div class="remarque">
              <div class="doux">${new Date(x.cree_le).toLocaleDateString('fr-FR')}${x.note ? ' · ' + '★'.repeat(x.note) : ''}</div>
              <p>${echapper(x.contenu)}</p>
            </div>`).join('') : '<p class="vide">Aucune remarque pour le moment.</p>'}
        </div>`;
    }
    return formulaire + synthese;
  }

  function vueGestion() {
    const optionsDest = (sel) => `<option value="">—</option>` + etat.destinations.map((d) => `<option value="${d.id}" ${d.id === sel ? 'selected' : ''}>${echapper(d.nom)}</option>`).join('');
    return `
      <form class="carte formulaire" id="form-params">
        <h2>Véhicule</h2>
        <div class="grille-2">
          <label>Nombre de places total
            <input type="number" name="places_total" min="1" max="60" value="${etat.parametres.places_total}" required>
          </label>
          <label>Statut du véhicule
            <input type="text" name="statut" value="${echapper(etat.parametres.statut)}" placeholder="Ex. : Disponible">
          </label>
        </div>
        <button class="bouton principal" type="submit">Enregistrer</button>
      </form>

      <div class="carte">
        <h2>Destinations</h2>
        <p class="doux">Plus le chiffre de priorité est petit, plus la destination passe en premier.</p>
        ${etat.destinations.length ? `<ul class="liste">${etat.destinations.map((d) => `
          <li>
            <span>${echapper(d.nom)}</span>
            <span style="display:flex;gap:.5rem;align-items:center">
              <input type="number" style="width:78px" aria-label="Priorité de ${echapper(d.nom)}" data-dest-prio="${d.id}" value="${d.priorite}">
              <button class="bouton danger" data-sup-dest="${d.id}">Supprimer</button>
            </span>
          </li>`).join('')}</ul>` : '<p class="vide">Aucune destination. Ajoutez la première ci-dessous.</p>'}
        <form class="formulaire" id="form-dest">
          <div class="grille-2">
            <label>Nom de la destination<input type="text" name="nom" required></label>
            <label>Priorité<input type="number" name="priorite" value="${(etat.destinations.at(-1)?.priorite ?? 0) + 10}" required></label>
          </div>
          <button class="bouton signal" type="submit">Ajouter la destination</button>
        </form>
      </div>

      <div class="carte">
        <h2>Membres</h2>
        <p class="doux">Les titulaires sont acceptés d’office. Pour les invités, la priorité la plus basse passe en premier.</p>
        <div class="tableau">
          <table>
            <thead><tr><th>Nom</th><th>Rôle</th><th>Statut</th><th>Priorité</th><th>Destination habituelle</th><th>Actif</th></tr></thead>
            <tbody>
              ${etat.profils.map((p) => `
                <tr data-membre="${p.id}">
                  <td>${echapper(nomAffiche(p))}<div class="doux">${echapper(p.email || '')}</div></td>
                  <td><select data-champ="role">
                    ${['passager', 'conducteur', 'gestionnaire'].map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}
                  </select></td>
                  <td><select data-champ="statut">
                    <option value="titulaire" ${p.statut === 'titulaire' ? 'selected' : ''}>Titulaire</option>
                    <option value="invite" ${p.statut === 'invite' ? 'selected' : ''}>Invité</option>
                  </select></td>
                  <td><input type="number" data-champ="priorite" value="${p.priorite}"></td>
                  <td><select data-champ="destination_id">${optionsDest(p.destination_id)}</select></td>
                  <td><input type="checkbox" data-champ="actif" ${p.actif ? 'checked' : ''} style="width:auto"></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  /* ================= Rendu ================= */
  function onglets() {
    const liste = [];
    if (!estConducteur()) liste.push(['demandes', 'Ma demande']);
    if (estConducteur() || estGestionnaire()) liste.push(['trajet', 'Trajet']);
    if (!estConducteur()) liste.push(['remarques', 'Remarques']);
    if (estGestionnaire()) liste.push(['gestion', 'Gestion']);
    return liste;
  }

  function rendre() {
    if (!etat.profil) return;
    const liste = onglets();
    if (!liste.some(([id]) => id === etat.onglet)) etat.onglet = liste[0][0];

    $('#utilisateur').textContent = nomAffiche(etat.profil);
    $('#nav').innerHTML = liste.map(([id, nom]) => `<button data-onglet="${id}" ${id === etat.onglet ? 'aria-current="page"' : ''}>${nom}</button>`).join('');

    const vues = { demandes: vueDemandes, trajet: vueTrajet, remarques: vueRemarques, gestion: vueGestion };
    const zone = $('#vue');
    // Conserve le focus/scroll lors des rechargements temps réel
    const defilement = window.scrollY;
    zone.innerHTML = vues[etat.onglet]();
    window.scrollTo(0, defilement);
  }

  /* ================= Actions ================= */
  async function enregistrerDemande() {
    const active = $('#chk-demande').checked;
    const destination = $('#sel-destination').value;
    const { error } = await bd.from('demandes').upsert(
      { profil_id: etat.profil.id, jour: etat.jour, active, destination_id: destination ? Number(destination) : null, modifie_le: new Date().toISOString() },
      { onConflict: 'profil_id,jour' }
    );
    if (error) return afficherToast('Enregistrement impossible : ' + error.message, true);
    afficherToast(active ? 'Demande enregistrée' : 'Demande désactivée');
    await rechargerDemandes();
  }

  async function mettreAJourMembre(id, champ, valeur) {
    if (id === etat.profil.id && champ === 'role' && valeur !== 'gestionnaire' && !confirm('Vous allez perdre vos droits de gestionnaire. Continuer ?')) return rendre();
    const { error } = await bd.from('profils').update({ [champ]: valeur }).eq('id', id);
    if (error) { afficherToast('Modification impossible : ' + error.message, true); return rendre(); }
    afficherToast('Membre mis à jour');
    await chargerTout();
    rendre();
  }

  function brancherEvenements() {
    const vue = $('#vue');

    $('#nav').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-onglet]');
      if (!b) return;
      etat.onglet = b.dataset.onglet;
      if (etat.onglet === 'remarques') await chargerRemarques();
      rendre();
    });

    vue.addEventListener('click', async (e) => {
      const jour = e.target.closest('[data-jour]');
      if (jour) { etat.jour = jour.dataset.jour; return rendre(); }

      const sup = e.target.closest('[data-sup-dest]');
      if (sup && confirm('Supprimer cette destination ?')) {
        const { error } = await bd.from('destinations').delete().eq('id', sup.dataset.supDest);
        if (error) return afficherToast(error.message, true);
        await chargerTout(); rendre(); afficherToast('Destination supprimée');
      }

      const etoile = e.target.closest('.etoiles label');
      if (etoile) {
        const n = Number(etoile.dataset.n);
        document.querySelectorAll('.etoiles label').forEach((l) => l.classList.toggle('on', Number(l.dataset.n) <= n));
      }
    });

    vue.addEventListener('change', async (e) => {
      const cible = e.target;
      if (cible.id === 'chk-demande' || cible.id === 'sel-destination') return enregistrerDemande();

      if (cible.dataset.destPrio) {
        const { error } = await bd.from('destinations').update({ priorite: Number(cible.value) }).eq('id', cible.dataset.destPrio);
        if (error) return afficherToast(error.message, true);
        await chargerTout(); rendre(); return afficherToast('Priorité mise à jour');
      }

      if (cible.dataset.champ) {
        const id = cible.closest('[data-membre]').dataset.membre;
        const champ = cible.dataset.champ;
        let valeur = cible.type === 'checkbox' ? cible.checked : cible.value;
        if (champ === 'priorite') valeur = Number(valeur);
        if (champ === 'destination_id') valeur = valeur ? Number(valeur) : null;
        return mettreAJourMembre(id, champ, valeur);
      }
    });

    vue.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const donnees = new FormData(f);

      if (f.id === 'form-params') {
        const { error } = await bd.from('parametres').update({ places_total: Number(donnees.get('places_total')), statut: donnees.get('statut') }).eq('id', 1);
        if (error) return afficherToast(error.message, true);
        await chargerTout(); rendre(); afficherToast('Véhicule mis à jour');
      }

      if (f.id === 'form-dest') {
        const { error } = await bd.from('destinations').insert({ nom: donnees.get('nom').trim(), priorite: Number(donnees.get('priorite')) });
        if (error) return afficherToast(error.message, true);
        await chargerTout(); rendre(); afficherToast('Destination ajoutée');
      }

      if (f.id === 'form-remarque') {
        const note = donnees.get('note') ? Number(donnees.get('note')) : null;
        const { error } = await bd.from('remarques').insert({ contenu: donnees.get('contenu').trim(), note });
        if (error) return afficherToast(error.message, true);
        f.reset();
        document.querySelectorAll('.etoiles label').forEach((l) => l.classList.remove('on'));
        if (estGestionnaire()) await chargerRemarques();
        rendre(); afficherToast('Remarque envoyée, merci');
      }
    });

    $('#btn-deconnexion').addEventListener('click', () => bd.auth.signOut());
  }

  /* ================= Connexion ================= */
  function montrer(id) {
    ['chargement', 'connexion', 'app'].forEach((x) => ($('#' + x).hidden = x !== id));
  }

  function majFormulaireConnexion() {
    $('#champ-nom').hidden = !etat.modeInscription;
    $('#btn-connexion').textContent = etat.modeInscription ? 'Créer mon compte' : 'Se connecter';
    $('#btn-bascule').textContent = etat.modeInscription ? 'Déjà un compte ? Se connecter' : 'Pas de compte ? Créer un compte';
    $('#form-connexion').mdp.autocomplete = etat.modeInscription ? 'new-password' : 'current-password';
  }

  function brancherConnexion() {
    $('#btn-bascule').addEventListener('click', () => {
      etat.modeInscription = !etat.modeInscription;
      $('#erreur-connexion').hidden = true;
      majFormulaireConnexion();
    });

    $('#form-connexion').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const erreur = $('#erreur-connexion');
      const bouton = $('#btn-connexion');
      erreur.hidden = true;
      bouton.disabled = true;
      try {
        if (etat.modeInscription) {
          const { data, error } = await bd.auth.signUp({ email: f.email.value.trim(), password: f.mdp.value, options: { data: { nom: f.nom.value.trim() } } });
          if (error) throw error;
          if (!data.session) {
            erreur.textContent = 'Compte créé. Vérifiez votre boîte mail pour confirmer votre adresse, puis connectez-vous.';
            erreur.hidden = false;
            etat.modeInscription = false;
            majFormulaireConnexion();
          }
        } else {
          const { error } = await bd.auth.signInWithPassword({ email: f.email.value.trim(), password: f.mdp.value });
          if (error) throw error;
        }
      } catch (err) {
        erreur.textContent = err.message === 'Invalid login credentials' ? 'E-mail ou mot de passe incorrect.' : err.message;
        erreur.hidden = false;
      } finally {
        bouton.disabled = false;
      }
    });
  }

  async function entrerDansApp(utilisateur) {
  console.log('Utilisateur connecté :', utilisateur.id);

  etat.idUtilisateur = utilisateur.id;
  montrer('chargement');

  try {
    await chargerTout();

    console.log('Profil récupéré :', etat.profil);

    if (!etat.profil) {
      throw new Error(
        'Aucun profil associé à cet utilisateur. Vérifiez la correspondance entre profils.id et auth.users.id.'
      );
    }

    await chargerRemarques();

    montrer('app');
    rendre();

    console.log('Application chargée avec succès.');

    bd.removeAllChannels();

    bd.channel('suivi-demandes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'demandes' },
        rechargerDemandes
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'parametres' },
        async () => {
          await chargerTout();
          rendre();
        }
      )
      .subscribe();

  } catch (err) {
    console.error('Erreur entrée application :', err);

    montrer('connexion');

    const e = $('#erreur-connexion');
    e.textContent = err.message || 'Erreur de chargement.';
    e.hidden = false;
  }
}

  /* ================= Installation PWA ================= */
  let invitationInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    invitationInstall = e;
    $('#btn-installer').hidden = false;
  });
  window.addEventListener('appinstalled', () => { $('#btn-installer').hidden = true; afficherToast('Gestiga est installée'); });

  function brancherInstallation() {
    const bouton = $('#btn-installer');
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const dejaInstallee = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (ios && !dejaInstallee) {
      bouton.hidden = false;
      bouton.addEventListener('click', () => afficherToast('Sur iPhone : touchez Partager puis « Sur l’écran d’accueil »'));
      return;
    }
    bouton.addEventListener('click', async () => {
      if (!invitationInstall) return;
      invitationInstall.prompt();
      await invitationInstall.userChoice;
      invitationInstall = null;
      bouton.hidden = true;
    });
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* ================= Démarrage ================= */
  function demarrer() {
    if (!configOk) {
      montrer('connexion');
      const e = $('#erreur-connexion');
      e.textContent = 'Configuration manquante : renseignez votre adresse et votre clé Supabase dans config.js.';
      e.hidden = false;
      $('#btn-connexion').disabled = true;
      return;
    }
    brancherConnexion();
    brancherEvenements();
    brancherInstallation();
    majFormulaireConnexion();

    bd.auth.onAuthStateChange((evenement, session) => {
      if (evenement === 'SIGNED_OUT' || !session) {
        etat.idUtilisateur = null;
        etat.profil = null;
        bd.removeAllChannels();
        montrer('connexion');
      } else if (session.user.id !== etat.idUtilisateur) {
        // différé pour éviter un blocage connu de supabase-js dans ce callback
        setTimeout(() => entrerDansApp(session.user), 0);
      }
    });
  }

  demarrer();
})();
