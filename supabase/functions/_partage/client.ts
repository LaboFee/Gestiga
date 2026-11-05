import { createClient } from "npm:@supabase/supabase-js@2";

// Client avec la cle de service : contourne la RLS, reserve aux fonctions hebergees.
export const clientService = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export function echapperHtml(texte: string): string {
  return texte
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formaterDateLongue(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
