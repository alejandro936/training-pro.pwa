export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    const { email, deviceId } = req.body || {};
    const email_lc = String(email || '').trim().toLowerCase();
    if (!email_lc || !/@/.test(email_lc)) return res.status(400).json({ ok:false, error:'Email no válido' });

    // ENV
    const PAT    = process.env.AIRTABLE_PAT;
    const BASE_CLIENTES = process.env.AIRTABLE_BASE;
    const TBL_C  = process.env.TABLE_CLIENTES_ID || process.env.TABLE_CLIENTES || 'CLIENTES';
    const TBL_S  = process.env.TABLE_SESSIONS || 'SESSIONS';
    const SECRET = process.env.SECRET || 'change-me';
    const ACCESS_FIELD = process.env.CLIENTES_ACCESS_FIELD || 'Acceso a Biblioteca'; // <- configurable

    // Validaciones mínimas de ENV
    if (!PAT)  return res.status(500).json({ ok:false, error:'Falta AIRTABLE_PAT' });
    if (!BASE) return res.status(500).json({ ok:false, error:'Falta AIRTABLE_BASE' });
    if (!TBL_C) return res.status(500).json({ ok:false, error:'Falta TABLE_CLIENTES_ID/TABLE_CLIENTES' });

    // 1) Buscar cliente
    const formula = `LOWER({Email})="${email_lc}"`;
    const urlClientes = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_C)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

    const rClients = await fetch(urlClientes, { headers: { Authorization: `Bearer ${PAT}` } });
    const textClients = await rClients.text(); // para debug
    if (!rClients.ok) {
      return res.status(502).json({
        ok:false,
        error:`Airtable CLIENTES error: HTTP ${rClients.status}`,
        detail:textClients.slice(0,500),
        hint:`Revisa TABLE_CLIENTES_ID/TABLE_CLIENTES (nombre/ID correcto) y permisos del PAT`
      });
    }
    const jClients = JSON.parse(textClients);
    const rec = (jClients.records || [])[0];
    if (!rec) {
      return res.status(403).json({ ok:false, error:'Email no encontrado en CLIENTES' });
    }

    // 2) ¿Tiene acceso? (campo configurable y valores amplios)
    const v = rec.fields && rec.fields[ACCESS_FIELD];
    const allowed = (
      v === true || v === 1 ||
      (typeof v === 'string' && ['si','sí','yes','true','1','y','s'].includes(v.trim().toLowerCase()))
    );
    if (!allowed) {
      return res.status(403).json({
        ok:false,
        error:`No tienes acceso activo (${ACCESS_FIELD} ≠ Sí).`,
        hint:`Cambia CLIENTES_ACCESS_FIELD o corrige el campo en Airtable`
      });
    }

    // 3) Generar token y upsert en SESSIONS
    const token = await makeToken(email_lc, SECRET);
    const payload = { fields: { 'Email_lc': email_lc, 'Token': token, 'DeviceId': String(deviceId || '') } };

    // Buscar sesión existente por Email_lc
    const urlFind = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{Email_lc}="${email_lc}"`)}&maxRecords=1`;
    const rFind = await fetch(urlFind, { headers: { Authorization: `Bearer ${PAT}` } });
    const jFind = await rFind.json();
    const existing = (jFind.records || [])[0];

    let rSave, textSave;
    if (existing) {
      const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${existing.id}`;
      rSave = await fetch(urlPatch, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      textSave = await rSave.text();
    } else {
      const urlPost = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}`;
      rSave = await fetch(urlPost, {
        method: 'POST',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      textSave = await rSave.text();
    }
    if (!rSave.ok) {
      return res.status(502).json({
        ok:false,
        error:`Airtable SESSIONS error: HTTP ${rSave.status}`,
        detail:textSave.slice(0,500),
        hint:`Revisa TABLE_SESSIONS y permisos de escritura del PAT`
      });
    }

    return res.status(200).json({ ok:true, token, redirect:'/interfaz/' });

  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}

/* ===== helpers ===== */
async function makeToken(email_lc, secret) {
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
    const { randomBytes } = require('crypto');
    const b = randomBytes(n);
    for (let i=0;i<n;i++) bytes[i] = b[i];
  }
  return Buffer.from(bytes).toString('base64url');
}

async function hmacSha256(msg, key) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg));
  return Buffer.from(new Uint8Array(sig)).toString('base64url');
}
function toB64Url(s) {
  return Buffer.from(s).toString('base64url');
}
