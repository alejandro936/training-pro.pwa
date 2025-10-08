// api/_lib/airtable.js
export async function atList({ baseId, table, params = {} }) {
  const PAT = process.env.AIRTABLE_PAT;
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}${qs ? `?${qs}` : ''}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function atGet({ baseId, table, id }) {
  const PAT = process.env.AIRTABLE_PAT;
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${id}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function createSession({ email, deviceId }) {
  const PAT = process.env.AIRTABLE_PAT;
  const BASE = process.env.AIRTABLE_BASE_SESSIONS;
  const TABLE = process.env.AIRTABLE_SESSIONS;
  const SECRET = process.env.SECRET;

  if (!PAT || !BASE || !TABLE || !SECRET) {
    throw new Error('Faltan variables de entorno necesarias');
  }

  const email_lc = email.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const token = await makeToken(email_lc, SECRET);

  const urlFind = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}?filterByFormula=${encodeURIComponent(`{email_lc}="${email_lc}"`)}&maxRecords=1`;
  const rFind = await fetch(urlFind, { headers: { Authorization: `Bearer ${PAT}` } });
  const jFind = await rFind.json();
  const existing = (jFind.records || [])[0];

  const fullFields = {
    email_lc,
    ts_login: nowIso,
    Token: token,
    DeviceId: deviceId,
  };

  if (existing) {
    const exFields = existing.fields || {};
    const exDevice = exFields.DeviceId;
    const exToken = exFields.Token;
    const exTsLogout = exFields.ts_logout;

    const exIsActive = !!exToken && !exTsLogout;

    if (exIsActive && exDevice && exDevice !== deviceId) {
      throw new Error('Sesión ya iniciada en otro dispositivo');
    }

    const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}/${existing.id}`;
    await fetch(urlPatch, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: fullFields }),
    });
  } else {
    const urlPost = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`;
    await fetch(urlPost, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields: fullFields }] }),
    });
  }

  return { ok: true, token };
}

import crypto from 'crypto';

function b64u(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function makeToken(sub, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'TP' };
  const body = { sub, iat: now };
  const h = b64u(JSON.stringify(header));
  const b = b64u(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${h}.${b}.${sig}`;
}
