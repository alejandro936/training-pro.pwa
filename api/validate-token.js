// /api/validate-token.js
// Valida email contra CLIENTES (Airtable), upsert en SESSIONS y devuelve token + redirect

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const {
      AIRTABLE_PAT,
      AIRTABLE_BASE_CLIENTES,
      AIRTABLE_BASE, // fallback
      TABLE_CLIENTES_ID,
      TABLE_CLIENTES,
      TABLE_SESSIONS,
      CLIENTES_ACCESS_FIELD,
      SESSION_DAYS,
      SECRET,
    } = process.env;

    // === Config ===
    const PAT    = AIRTABLE_PAT;
    const BASE_C = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE; // ← usamos tu base de CLIENTES/SESSIONS
    const TBL_C  = TABLE_CLIENTES_ID || TABLE_CLIENTES || 'CLIENTES';
    const TBL_S  = TABLE_SESSIONS || 'SESSIONS';
    const ACCESS = CLIENTES_ACCESS_FIELD || 'Acceso a Biblioteca';
    const DAYS   = Number(SESSION_DAYS || '30'); // 0 = sin caducidad
    const SECRET_KEY = (SECRET || 'change-me') + ''; // string

    if (!PAT || !BASE_C || !TBL_C || !TBL_S || !SECRET_KEY) {
      return res.status(500).json({ ok: false, error: 'Missing env vars (PAT/BASE/TABLES/SECRET)' });
    }

    const body = await readJson(req);
    const email_raw = (body && body.email) ? String(body.email).trim().toLowerCase() : '';
    if (!email_raw || !email_raw.includes('@')) {
      return res.status(400).json({ ok: false, error: 'Email inválido' });
    }

    // === 1) CLIENTES: comprobar acceso activo ===
    
    // Fórmula flexible: Email o Email_lc, y campo de acceso verdadero (1/TRUE/"si"/"sí")
const F = ACCESS; // p.ej. 'Acceso a Biblioteca'
const formula = `AND(
  OR(
    LOWER({Email})="${email_raw}",
    IFERROR({Email_lc},"")="${email_raw}"
  ),
  OR(
    {${F}}=1,
    {${F}}=TRUE(),
    LOWER(SUBSTITUTE({${F}},"í","i"))="si"
  )
)`;

    const urlClientes =
      `https://api.airtable.com/v0/${BASE_C}/${encodeURIComponent(TBL_C)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

    const rCl = await fetch(urlClientes, {
      headers: { Authorization: `Bearer ${PAT}` },
    });
    if (!rCl.ok) {
      const txt = await rCl.text();
      return res.status(rCl.status).json({
        ok: false,
        error: `Airtable CLIENTES error: HTTP ${rCl.status}`,
        detail: safeCut(txt, 400),
        hint: 'Revisa AIRTABLE_BASE_CLIENTES / TABLE_CLIENTES_ID y permisos del PAT (read).',
      });
    }
    const cl = await rCl.json();
    const hasAccess = Array.isArray(cl.records) && cl.records.length > 0;
    if (!hasAccess) {
      return res.status(403).json({ ok: false, error: 'No tienes acceso activo. Contacta con soporte si crees que es un error.' });
    }

    // === 2) SESSIONS: upsert por email_lc ===
const email_lc = email_raw;

// nombres REALES de campos en tu tabla SESSIONS
const F_EMAIL = process.env.SESSIONS_EMAIL_FIELD || 'email_lc';
const F_TS    = process.env.SESSIONS_TS_FIELD    || 'ts_login';

// 2.1 Buscar si ya existe sesión para ese email
const findUrl =
  `https://api.airtable.com/v0/${BASE_C}/${encodeURIComponent(TBL_S)}?filterByFormula=${
    encodeURIComponent(`{${F_EMAIL}}="${email_lc}"`)
  }&maxRecords=1`;

const rFind = await fetch(findUrl, { headers: { Authorization: `Bearer ${PAT}` } });
if (!rFind.ok) {
  const txt = await rFind.text();
  return res.status(rFind.status).json({
    ok: false,
    error: `Airtable SESSIONS (find) error: HTTP ${rFind.status}`,
    detail: safeCut(txt, 400),
    hint: 'Revisa TABLE_SESSIONS y permisos PAT (write si hay update/insert).',
  });
}

const found  = await rFind.json();
const nowIso = new Date().toISOString();

// 2.2 Upsert (update si existe, si no insert)
if (Array.isArray(found.records) && found.records.length > 0) {
  const recId = found.records[0].id; // update
  const rUp = await fetch(
    `https://api.airtable.com/v0/${BASE_C}/${encodeURIComponent(TBL_S)}/${recId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: { [F_EMAIL]: email_lc, [F_TS]: nowIso } }),
    }
  );
  if (!rUp.ok) {
    const txt = await rUp.text();
    return res.status(rUp.status).json({
      ok: false,
      error: `Airtable SESSIONS (update) error: HTTP ${rUp.status}`,
      detail: safeCut(txt, 400),
    });
  }
} else {
  const rIns = await fetch(
    `https://api.airtable.com/v0/${BASE_C}/${encodeURIComponent(TBL_S)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records: [{ fields: { [F_EMAIL]: email_lc, [F_TS]: nowIso } }],
      }),
    }
  );
  if (!rIns.ok) {
    const txt = await rIns.text();
    return res.status(rIns.status).json({
      ok: false,
      error: `Airtable SESSIONS (insert) error: HTTP ${rIns.status}`,
      detail: safeCut(txt, 400),
    });
  }
}

    // === 3) Token + redirect ===
    const token = signToken({ sub: email_lc }, SECRET_KEY, DAYS);
    const redirect = '/interfaz/';

    return res.status(200).json({ ok: true, token, redirect });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ---------- helpers ---------- */

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}

function safeCut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

// HS256 estilo “header.payload.sig” (base64url)
import crypto from 'crypto';
function b64u(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function signToken(payload, secret, days) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'TP' };
  const body = { ...payload, iat: now };
  if (days > 0) body.exp = now + days * 86400;

  const h = b64u(JSON.stringify(header));
  const b = b64u(JSON.stringify(body));
  const msg = `${h}.${b}`;
  const sig = crypto.createHmac('sha256', secret).update(msg).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${msg}.${sig}`;
}
