// Envoie au gestionnaire unique le resume des mouvements sur les demandes.
function echapperHtml(texte: string): string {
  return texte
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CLE_RESEND = Deno.env.get("RESEND_API_KEY");
const EXPEDITEUR = Deno.env.get("EXPEDITEUR_COURRIEL") ?? "Gestiga <onboarding@resend.dev>";

const LIBELLES: Record<string, string> = {
  cree: "Nouvelle demande",
  statut_modifie: "Statut modifié",
  destination_modifie: "Destination modifiée",
};

const STATUTS: Record<string, string> = {
  en_attente: "en attente de décision",
  acceptee: "acceptée",
  refusee: "refusée",
  annule: "désactivée",
};

interface Evenement {
  id: number;
  demande_id: string;
  action: string;
  ancien_statut: string | null;
  nouveau_statut: string | null;
  ancienne_destination_id: string | null;
  nouvelle_destination_id: string | null;
  survenu_le: string;
}

Deno.serve(async () => {
  const { data: file, error: erreurFile } = await clientService
    .from("file_courriels")
    .update({ statut: "en_traitement" })
    .eq("statut", "en_attente")
    .select("id, evenement_demande_id");
  if (erreurFile) return new Response(erreurFile.message, { status: 500 });
  if (!file?.length) return new Response("Aucun message à envoyer.");

  const idsFile = file.map((ligne) => ligne.id);
  const replanifier = () => clientService.from("file_courriels")
    .update({ statut: "en_attente" }).in("id", idsFile);
  const echouer = (message: string) => clientService.from("file_courriels")
    .update({ statut: "en_attente", derniere_erreur: message }).in("id", idsFile);

  const { data: parametres, error: erreurParametres } = await clientService
    .from("parametres_application")
    .select("courriel_gestionnaire")
    .eq("instance_unique", true)
    .single();
  if (erreurParametres || !parametres?.courriel_gestionnaire) {
    await replanifier();
    return new Response("L'adresse du gestionnaire n'est pas configurée.", { status: 500 });
  }
  if (!CLE_RESEND) {
    await replanifier();
    return new Response("La clé Resend n'est pas configurée.", { status: 500 });
  }

  const idsEvenements = file.map((ligne) => ligne.evenement_demande_id);
  const { data: evenements, error: erreurEvenements } = await clientService
    .from("evenements_demande")
    .select("id, demande_id, action, ancien_statut, nouveau_statut, ancienne_destination_id, nouvelle_destination_id, survenu_le")
    .in("id", idsEvenements)
    .order("id");
  if (erreurEvenements) {
    await replanifier();
    return new Response(erreurEvenements.message, { status: 500 });
  }

  const idsDemandes = [...new Set((evenements ?? []).map((evenement) => evenement.demande_id))];
  const { data: demandes, error: erreurDemandes } = await clientService
    .from("demandes_transport")
    .select("id, profil_id, date_service, destination_id")
    .in("id", idsDemandes);
  if (erreurDemandes) {
    await replanifier();
    return new Response(erreurDemandes.message, { status: 500 });
  }
  const idsProfils = [...new Set((demandes ?? []).map((demande) => demande.profil_id))];
  const idsDestinations = [...new Set((demandes ?? []).map((demande) => demande.destination_id))];
  const [{ data: profils }, { data: destinations }] = await Promise.all([
    clientService.from("profils").select("id, nom_affiche").in("id", idsProfils),
    idsDestinations.length
      ? clientService.from("destinations").select("id, nom").in("id", idsDestinations)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const demandeParId = new Map((demandes ?? []).map((demande) => [demande.id, demande]));
  const profilParId = new Map((profils ?? []).map((profil) => [profil.id, profil]));
  const destinationParId = new Map((destinations ?? []).map((destination) => [destination.id, destination]));

  const lignes = (evenements as Evenement[] ?? []).map((evenement) => {
    const demande = demandeParId.get(evenement.demande_id);
    if (!demande) return "";
    const profil = profilParId.get(demande.profil_id);
    const destination = destinationParId.get(demande.destination_id);
    const etat = evenement.nouveau_statut ? STATUTS[evenement.nouveau_statut] ?? evenement.nouveau_statut : "";
    return `<li><strong>${echapperHtml(LIBELLES[evenement.action] ?? evenement.action)}</strong> — ` +
      `${echapperHtml(profil?.nom_affiche ?? "Passager")} — ${echapperHtml(destination?.nom ?? "Destination inconnue")}` +
      `, le ${echapperHtml(formaterDateLongue(demande.date_service))}` +
      `${etat ? ` — ${echapperHtml(etat)}` : ""}</li>`;
  }).filter(Boolean);

  if (!lignes.length) {
    await clientService.from("file_courriels").update({ statut: "envoye", envoye_le: new Date().toISOString() }).in("id", idsFile);
    return new Response("Aucun mouvement détaillé.");
  }

  const reponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${CLE_RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EXPEDITEUR,
      to: [parametres.courriel_gestionnaire],
      subject: `Gestiga — ${lignes.length} mouvement${lignes.length > 1 ? "s" : ""} sur les demandes`,
      html: `<p>Mouvements enregistrés :</p><ul>${lignes.join("")}</ul>`,
    }),
  });

  if (!reponse.ok) {
    const message = await reponse.text();
    await echouer(message);
    return new Response(message, { status: 502 });
  }
  await clientService.from("file_courriels")
    .update({ statut: "envoye", derniere_erreur: null, envoye_le: new Date().toISOString() })
    .in("id", idsFile);
  return Response.json({ envoyes: lignes.length });
});
