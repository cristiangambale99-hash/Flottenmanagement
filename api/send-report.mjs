/**
 * Clean Service Scaramuzzo AG — Versand der Fahrzeug-Inspektionsberichte
 *
 * Liegt im Vercel-Projekt unter  api/send-report.mjs  und ist damit unter
 * /api/send-report erreichbar — gleiche Domain wie die App, deshalb kein
 * CORS-Problem und kein Schlüssel im Browser.
 *
 * Die Endung .mjs ist bewusst gewählt: Vercel führt die Datei damit als
 * ES-Modul aus, sonst scheitert das "export default" ohne package.json.
 * Ein Inspektions-PDF liegt bei rund 90 KB und damit weit unter dem
 * Anfragelimit von 4,5 MB.
 *
 * Versand fest über Resend.
 *
 * Environment Variables im Vercel-Projekt (Settings > Environment Variables):
 *   RESEND_API_KEY     Pflicht. API-Schlüssel aus dem Resend-Konto.
 *   MAIL_FROM          Optional. Standard: Flottenmanagement <flotte@clean-service.ch>
 *                      Die Domain muss in Resend verifiziert sein.
 *   MAIL_REPLY_TO      Optional. Antwortadresse, z. B. c.gambale@clean-service.ch
 *   ALLOWED_RECIPIENT  Optional. Standard ist die Teams-Kanaladresse unten.
 */

const DEFAULT_TO = "c1c5ced6.clean-service.ch@emea.teams.ms";
const DEFAULT_FROM = "Flottenmanagement <flotte@clean-service.ch>";
const MAX_BYTES = 8 * 1024 * 1024;

/* Resend-Fehlercodes in Klartext, damit die App etwas Brauchbares anzeigt. */
function erklaere(status, detail) {
  if (status === 401) return "Resend lehnt den API-Schlüssel ab (RESEND_API_KEY prüfen).";
  if (status === 403) return "Absenderdomain ist in Resend nicht verifiziert (MAIL_FROM prüfen).";
  if (status === 422) return "Resend akzeptiert Absender oder Empfänger nicht: " + detail;
  if (status === 429) return "Resend-Limit erreicht — bitte kurz warten.";
  return "Resend meldet HTTP " + status + (detail ? " — " + detail : "");
}

async function sendeMitResend(nutzlast) {
  const antwort = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(nutzlast),
  });
  const text = await antwort.text();
  let daten = {};
  try { daten = JSON.parse(text); } catch { /* Resend antwortet im Fehlerfall nicht immer als JSON */ }
  return { ok: antwort.ok, status: antwort.status, daten, text };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Nur POST" });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: "RESEND_API_KEY ist im Vercel-Projekt nicht gesetzt." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const erlaubt = (process.env.ALLOWED_RECIPIENT || DEFAULT_TO).toLowerCase();
  const to = String(body.to || erlaubt).toLowerCase();
  const subject = body.subject || "Fahrzeug-Inspektion";
  const text = body.body || "";
  const filename = body.filename || "Fahrzeug-Inspektion.pdf";
  const contentBase64 = body.contentBase64;

  if (!contentBase64) return res.status(400).json({ error: "Kein PDF im Aufruf." });
  if (to !== erlaubt) return res.status(403).json({ error: "Empfängeradresse ist nicht freigegeben." });
  if (Math.floor((contentBase64.length * 3) / 4) > MAX_BYTES) {
    return res.status(413).json({ error: "Anhang ist zu gross." });
  }

  const nutzlast = {
    from: process.env.MAIL_FROM || DEFAULT_FROM,
    to: [to],
    subject,
    text,
    attachments: [{ filename, content: contentBase64 }],
  };
  if (process.env.MAIL_REPLY_TO) nutzlast.reply_to = process.env.MAIL_REPLY_TO;

  try {
    let ergebnis = await sendeMitResend(nutzlast);

    /* Bei Ratenbegrenzung einmal nachfassen. */
    if (!ergebnis.ok && ergebnis.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      ergebnis = await sendeMitResend(nutzlast);
    }

    if (!ergebnis.ok) {
      const detail = (ergebnis.daten && ergebnis.daten.message) || ergebnis.text.slice(0, 200);
      return res.status(502).json({ error: erklaere(ergebnis.status, detail) });
    }

    return res.status(200).json({
      ok: true,
      via: "resend",
      to,
      filename,
      id: ergebnis.daten && ergebnis.daten.id,
    });
  } catch (e) {
    return res.status(502).json({ error: "Resend nicht erreichbar: " + String(e.message || e) });
  }
}
