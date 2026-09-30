// Vercel Serverless Function: /api/send-mail
// Versendet die E-Mails der Fahrzeug-App (Tankprotokolle, Fahrzeugmeldungen, Übernahmen/Abgaben, Abschleppungen) über Resend,
// inklusive PDF-Anhang auf Logopapier.
//
// Environment Variables in Vercel (Project → Settings → Environment Variables):
//   RESEND_API_KEY  (Pflicht)  API-Key aus dem Resend-Konto
//   MAIL_FROM       (optional) Standard: "Fahrzeug-App Clean Service <fahrzeuge@clean-service.ch>"
//
// Schutz: Es werden nur Mails an die fest hinterlegten Empfänger verschickt.

const ERLAUBT = [
  'c08d33f1.clean-service.ch@emea.teams.ms', // Teams-Kanal Tankprotokolle
  '04fbbc5a.clean-service.ch@emea.teams.ms', // Teams-Kanal Infrastruktur (Fahrzeugmeldungen, Abschleppungen)
  'info@oerlike.ch',                         // Carrosserie
  'info@fegolaautomobile.ch',                // Garage Fegola Automobile
  '1b6e08b6.clean-service.ch@emea.teams.ms', // Teams-Kanal Übernahmen/Abgaben
  'buero@garage-gerstl.ch',                  // Garage Gerstl AG (Abschleppungen)
  'info.il@haeusermann.com',                 // Häusermann Automobile AG (Abschleppungen)
  'info@garagemoser.ch'                      // Garage Carrosserie Moser AG (Abschleppungen)
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Nur POST erlaubt' });

  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: 'RESEND_API_KEY ist in Vercel nicht hinterlegt' });

  let p = req.body;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return res.status(400).json({ error: 'Ungültiges JSON' }); } }
  p = p || {};

  const to = String(p.to || '').split(/[;,]/).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!to.length) return res.status(400).json({ error: 'Kein Empfänger' });
  const fremd = to.filter(a => !ERLAUBT.includes(a));
  if (fremd.length) return res.status(403).json({ error: 'Empfänger nicht erlaubt', fremd });
  if (!p.subject || !p.html) return res.status(400).json({ error: 'subject und html sind erforderlich' });
  if (String(p.subject).length > 300 || String(p.html).length > 200000) return res.status(413).json({ error: 'Inhalt zu gross' });

  const mail = {
    from: process.env.MAIL_FROM || 'Fahrzeug-App Clean Service <fahrzeuge@clean-service.ch>',
    to,
    subject: String(p.subject),
    html: String(p.html)
  };
  if (p.attachmentBase64) {
    let name = String(p.attachmentName || 'Protokoll.pdf').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    if (!name.endsWith('.pdf')) name += '.pdf';
    mail.attachments = [{ filename: name, content: String(p.attachmentBase64) }];
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(mail)
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: 'Resend-Fehler', detail: out });
    return res.status(200).json({ success: true, id: out.id });
  } catch (e) {
    return res.status(502).json({ error: 'Resend nicht erreichbar' });
  }
};
