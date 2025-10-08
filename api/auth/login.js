// /api/auth/login.js
// Valida email en CLIENTES y crea/actualiza SESSIONS (1 sesión por email)
// Soporta ?debug=1 (o true) para ver detalle de errores.

export default async function handler(req, res) {
  const debug = req.query && (req.query.debug === '1' || req.query.debug === 'true');

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok:false, error:'Method not allowed' });
    }

    // ===== ENV =====
    const {
      AIRTABLE_PAT,
      AIRTABLE_BASE_CLIENTES,
      AIRTABLE_BASE,          // fallback
      TABLE_CLIENTES_ID,
      TABLE_CLIENTES,
      TABLE_SESSIONS,
      CLIENTES_ACCESS_FIELD,
      SECRET,
    } = process.env;

    const PAT   = AIRTABLE_PAT;
    const BASE  = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;   // base donde están CLIENTES/SESSIONS
    const TBL_C = TABLE_CLIENTES_ID || TABLE_CLIENTES || 'CLIENTES';
    const TBL_S = TABLE_SESSIONS || 'SESSIONS';
    const ACCESS = CLIENTES_ACCESS_FIELD || 'Acceso a Biblioteca';

    if (!PAT || !BASE || !TBL_C || !TBL_S || !SECRET) {
      const msg = 'Missing env vars (AIRTABLE_PAT / AIRTABLE_BASE_CLIENTES|AIRTABLE_BASE / TABLE_CLIENTES_ID|TABLE_CLIENTES / TABLE_SESSIONS / SECRET)';
      return res.status(500).json(debug
        ? { ok:false, error:msg, detail:{ PAT:!!PAT, BASE, TBL_C, TBL_S, SECRET:!!SECRET } }
        : { ok:false, error:'Config error' }
      );
    }

    // ===== BODY =====
    const body = await readJson(req);
    const email_raw = (body && body.email) ? String(body.email).trim().toLowerCase() : '';
    const deviceId  = body && body.deviceId ? String(body.deviceId) : '';
    if (!email_raw || !email_raw.includes('@')) {
      return res.status(400).json({ ok:false, error:'Email inválido' });
    }
    const email_lc = email_raw;

    // ===== 1) CLIENTES: ¿tiene acceso? =====
    const F = ACCESS;
    const formulaClientes = `AND(
      OR(
        LOWER({Email})="${email_lc}",
        {Email_lc}="${email_lc}"
      ),
      OR(
        {${F}}=1,
        {${F}}=TRUE(),
        LOWER(SUBSTITUTE({${F}},"í","i"))="si"
      )
    )`;

    const urlCl =
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_C)}?filterByFormula=${encodeURIComponent(formulaClientes)}&maxRecords=1`;
    const rCl = await fetch(urlCl, { headers:{ Authorization:`Bearer ${PAT}` } });
    const txtCl = await rCl.text();
    if (!rCl.ok) {
      return res.status(rCl.status).json(debug
        ? { ok:false, error:`Airtable CLIENTES error: HTTP ${rCl.status}`, detail:safeCut(txtCl, 1000) }
        : { ok:false, error:`Airtable CLIENTES error: HTTP ${rCl.status}` }
      );
    }
    const jCl = safeJson(txtCl);
    if (!Array.isArray(jCl.records) || jCl.records.length === 0) {
      return res.status(403).json({ ok:false, error:'No tienes acceso activo.' });
    }

    // ===== 2) SESSIONS: detectar nombre de campo de email =====
    const EMAIL_FIELD_NAME = await detectEmailFieldName({ BASE, TBL_S, PAT });

    // ===== 3) Comprobar si ya existe fila en SESSIONS =====
    const formulaFind = `{${EMAIL_FIELD_NAME}}="${email_lc}"`;
    const urlFind =
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(formulaFind)}&maxRecords=1`;
    const rFind = await fetch(urlFind, { headers:{ Authorization:`Bearer ${PAT}` } });
    const txtFind = await rFind.text();
    if (!rFind.ok) {
      return res.status(502).json(debug
        ? { ok:false, error:`Airtable SESSIONS (find) error: HTTP ${rFind.status}`, detail:safeCut(txtFind, 1000) }
        : { ok:false, error:`Airtable SESSIONS (find) error: HTTP ${rFind.status}` }
      );
    }
    const jFind = safeJson(txtFind);
    const existing = (jFind.records || [])[0];

    const nowIso = new Date().toISOString();
    const token = await makeToken(email_lc, SECRET);

    // payload “completo”
    const fullFields = {
      [EMAIL_FIELD_NAME]: email_lc,
      ts_login: nowIso,
      Token: token,
      DeviceId: deviceId
    };
    // payload “mínimo”
    const minFields = {
      [EMAIL_FIELD_NAME]: email_lc,
      ts_login: nowIso
    };

    let rSave, txtSave;

    if (existing) {
      // PATCH (primero con todo; si 422, reintenta con mínimo)
      const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${existing.id}`;
      rSave = await fetch(urlPatch, {
        method:'PATCH',
        headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ fields: fullFields })
      });
      txtSave = await rSave.text();

      if (rSave.status === 422) {
        // reintento sin Token/DeviceId
        rSave = await fetch(urlPatch, {
          method:'PATCH',
          headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ fields: minFields })
        });
        txtSave = await rSave.text();
      }
    } else {
      // POST (primero con todo; si 422, reintenta con mínimo)
      const urlPost = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}`;
      rSave = await fetch(urlPost, {
        method:'POST',
        headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ records: [{ fields: fullFields }] })
      });
      txtSave = await rSave.text();

      if (rSave.status === 422) {
        // reintento sin Token/DeviceId
        rSave = await fetch(urlPost, {
          method:'POST',
          headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ records: [{ fields: minFields }] })
        });
        txtSave = await rSave.text();
      }
    }

    if (!rSave.ok) {
      return res.status(502).json(debug
        ? { ok:false, error:`Airtable SESSIONS error: HTTP ${rSave.status}`, detail:safeCut(txtSave, 2000) }
        : { ok:false, error:`Airtable SESSIONS error: HTTP ${rSave.status}` }
      );
    }

    return res.status(200).json({ ok:true, token, redirect:'/interfaz/' });

  } catch (e) {
    return res.status(500).json(debug
      ? { ok:false, error:'Exception', detail:String(e && e.message || e), stack:String(e && e.stack || '') }
      : { ok:false, error:'Error HTTP 500' }
    );
  }
}

/* ------- helpers ------- */
async function readJson(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return {}; }
}
function safeJson(txt){ try{ return JSON.parse(txt); } catch { return {}; } }
function safeCut(s, n){ s = String(s||''); return s.length>n ? s.slice(0,n)+'…' : s; }

// Detecta si la columna de email se llama "email_lc" o "Email_lc"
async function detectEmailFieldName({ BASE, TBL_S, PAT }){
  // probamos el filtro con email_lc; si Airtable lo acepta (200/OK), usamos ese.
  const test = async (field) => {
    const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{${field}}=""`)}&maxRecords=1`;
    const r = await fetch(u, { headers:{ Authorization:`Bearer ${PAT}` } });
    return r.ok ? field : null;
  };
  return (await test('email_lc')) || (await test('Email_lc')) || 'email_lc';
}

// Token simple HS256
import crypto from 'crypto';
function b64u(input){
  return Buffer.from(input).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
async function makeToken(sub, secret){
  const now = Math.floor(Date.now()/1000);
  const header = { alg:'HS256', typ:'TP' };
  const body   = { sub, iat: now };
  const h = b64u(JSON.stringify(header));
  const b = b64u(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
  return `${h}.${b}.${sig}`;
}
