// Envoie les rappels des jours de service aux titulaires et aux invites.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const clientService = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function formaterDateLongue(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUJET")!,
  Deno.env.get("VAPID_CLE_PUBLIQUE")!,
  Deno.env.get("VAPID_CLE_PRIVEE")!,
);

Deno.serve(async (requete) => {
  const { creneau } = await requete.json().catch(() => ({ creneau: "midi" }));
  const { data: dateService, error: erreurDate } = await clientService.rpc("prochain_jour_ouvre");
  if (erreurDate || !dateService) {
    return new Response(JSON.stringify({ erreur: erreurDate?.message }), { status: 500 });
  }
  const dateLocale = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Abidjan" }).format(new Date());
  if (dateService !== dateLocale) return Response.json({ envoyes: 0, jour_non_ouvre: true });

  const [{ data: passagers, error: erreurPassagers }, { data: demandes, error: erreurDemandes },
    { data: profils, error: erreurProfils }] = await Promise.all([
    clientService.from("passagers").select("profil_id, categorie").eq("est_actif", true),
    clientService.from("demandes_transport").select("profil_id, statut")
      .eq("date_service", dateService).neq("statut", "annule"),
    clientService.from("profils").select("id, statut_compte").eq("statut_compte", "actif"),
  ]);
  if (erreurPassagers || erreurDemandes || erreurProfils) {
    return new Response(JSON.stringify({ erreur: "Lecture des demandes impossible" }), { status: 500 });
  }

  const comptesActifs = new Set((profils ?? []).map((profil) => profil.id));
  const demandesActives = new Set((demandes ?? []).map((demande) => demande.profil_id));
  const dateLisible = formaterDateLongue(dateService);
  const messages = new Map<string, { titre: string; corps: string }>();

  for (const passager of passagers ?? []) {
    if (!comptesActifs.has(passager.profil_id)) continue;
    const aDemande = demandesActives.has(passager.profil_id);
    if (passager.categorie === "invite" && !aDemande) {
      messages.set(passager.profil_id, {
        titre: "Gestiga — faites votre demande",
        corps: `Pensez à demander une place pour ${dateLisible}.`,
      });
    } else if (passager.categorie === "titulaire" && aDemande) {
      messages.set(passager.profil_id, {
        titre: "Gestiga — libérez votre place",
        corps: creneau === "apres-midi"
          ? `Dernier rappel : désactivez votre demande du ${dateLisible} si vous ne voyagez pas.`
          : `Vous ne voyagez pas le ${dateLisible} ? Désactivez votre demande pour libérer votre place.`,
      });
    }
  }

  if (messages.size === 0) return Response.json({ envoyes: 0 });

  const { data: abonnements, error: erreurAbonnements } = await clientService
    .from("abonnements_notifications")
    .select("id, profil_id, point_acces, cles")
    .in("profil_id", [...messages.keys()]);
  if (erreurAbonnements) {
    return new Response(JSON.stringify({ erreur: "Lecture des abonnements impossible" }), { status: 500 });
  }

  let envoyes = 0;
  const expiries: string[] = [];
  await Promise.all((abonnements ?? []).map(async (abonnement) => {
    const message = messages.get(abonnement.profil_id)!;
    try {
      await webpush.sendNotification(
        { endpoint: abonnement.point_acces, keys: abonnement.cles },
        JSON.stringify({ ...message, url: "/" }),
      );
      envoyes++;
    } catch (erreur) {
      const code = (erreur as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) expiries.push(abonnement.id);
      else console.error("Echec de l'envoi du rappel", code);
    }
  }));

  if (expiries.length) {
    await clientService.from("abonnements_notifications").delete().in("id", expiries);
  }
  return Response.json({ envoyes, abonnements_expires: expiries.length });
});
