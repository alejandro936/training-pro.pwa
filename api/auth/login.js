export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const { email, deviceId } = req.body || {};
    const email_lc = String(email || '').trim().toLowerCase();
    if (!email_lc || !/@/.test(email_lc)) {
      res.status(400).json({ ok: false, error: 'Email no válido' }); return;
    }

    // --- ENV
    const PAT   = process.env.AIRTABLE_PAT;
    const BASE  = process.env.AIRTABLE_BASE;
    const TBL_C = process.env.TABLE_CLIENTES_ID || process.env.TABLE_CLIENTES || 'CLIENTES';
    const TBL_S = process.env.TABLE_SESSIONS || 'SESSIONS';
    const SECRET = process.env.SECRET || 'change-me';

    // ---- 1) Validar que el email tiene acceso en CLIENTES
    const formula = `OR(LOWER({Email})="${email_lc}", {Email_lc}="${email_lc}")`;
    const rClients = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_C)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`, {
      headers: { Authorization: `Bearer ${PAT}` }
    });
    if (!rClients.ok) {
      return res.status(502).json({ ok: false, error: 'Airtable CLIENTES error' });
    }
    const jClients = await rClients.json();
    const has = (jClients.records || []).some(rec => {
      const v = rec.fields['Acceso a Biblioteca'];
      return v === true || v === 1 || String(v).toLowerCase().startsWith('s'); // Sí/Si
    });
    if (!has) {
      return res.status(403).json({ ok: false, error: 'No tienes acceso activo.' });
    }

    // ---- 2) Emitir token nuevo y guardarlo en SESSIONS (sobrescribe el anterior)
    const token = await makeToken(email_lc, SECRET);
    const payload = {
      fields: {
        'Email_lc': email_lc,
        'Token': token,
        'DeviceId': String(deviceId || '')
      }
    };

    // upsert por Email_lc (1 sola sesión por email)
    // Estrategia: buscar si existe → PATCH por id; si no → POST nuevo
    const rFind = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{Email_lc}="${email_lc}"`)}&maxRecords=1`, {
      headers: { Authorization: `Bearer ${PAT}` }
    });
    const jFind = await rFind.json();
    const existing = (jFind.records || [])[0];

    let rSave;
    if (existing) {
      rSave = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${existing.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      rSave = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    if (!rSave.ok) {
      const t = await rSave.text();
      return res.status(502).json({ ok: false, error: 'Airtable SESSIONS error: ' + t });
    }

    // ---- 3) Ok → devuelve token y redirect recomendado
    res.status(200).json({ ok: true, token, redirect: '/interfaz/' });

  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}

/* ===== helpers ===== */
async function makeToken(email_lc, secret) {
  // token aleatorio + email + timestamp → Base64url
  const rand = cryptoRandom(32);
  const iat  = Math.floor(Date.now() / 1000);
  const raw  = `${email_lc}:${iat}:${rand}`;
  const sig  = await hmacSha256(raw, secret);
  return toB64Url(`${raw}.${sig}`);
}

function cryptoRandom(n) {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Node
    const { randomBytes } = require('crypto');
    const b = randomBytes(n);
    for (let i=0;i<n;i++) bytes[i] = b[i];
  }
  return Buffer.from(bytes).toString('base64url');
}

async function hmacSha256(msg, key) {
  // Node 18+ / Edge runtime
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg));
  return Buffer.from(new Uint8Array(sig)).toString('base64url');
}
function toB64Url(s) {
  return Buffer.from(s).toString('base64url');
}
