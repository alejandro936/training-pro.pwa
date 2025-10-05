// /api/auth/login.js
// Valida email en CLIENTES y crea/actualiza SESSIONS (1 sesión por email)
// Soporta ?debug=1 para sacar detalle de los errores

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
    const BASE  = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;   // base donde están CLIENTES y SESSIONS
    const TBL_C = TABLE_CLIENTES_ID || TABLE_CLIENTES || 'CLIENTES';
    const TBL_S = TABLE_SESSIONS      || 'SESSIONS';
    const ACCESS = CLIENTES_ACCESS_FIELD || 'Acceso a Biblioteca';

    if (!PAT || !BASE || !TBL_C || !TBL_S || !SECRET) {
      const msg = 'Missing env vars (AIRTABLE_PAT / AIRTABLE_BASE_CLIENTES|AIRTABLE_BASE / TABLE_CLIENTES_ID|TABLE_CLIENTES / TABLE_SESSIONS / SECRET)';
      if (debug) return res.status(500).json({ ok:false, error:msg, detail:{ PAT:!!PAT, BASE, TBL_C, TBL_S, SECRET:!!SECRET } });
      return res.status(500).json({ ok:false, error:'Config error' });
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
    const formula = `AND(
      OR(
        LOWER({Email})="${email_lc}",
        IFERROR({Email_lc},"")="${email_lc}"
      ),
      OR(
        {${F}}=1,
        {${F}}=TRUE(),
        LOWER(SUBSTITUTE({${F}},"í","i"))="si"
      )
    )`;

    const urlClientes =
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_C)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

    const rCl = await fetch(urlClientes, { headers: { Authorization:`Bearer ${PAT}` } });
    const txtCl = await rCl.text();
    if (!rCl.ok) {
      const payload = { ok:false, error:`Airtable CLIENTES error: HTTP ${rCl.status}` };
      if (debug) payload.detail = safeCut(txtCl, 1000);
      return res.status(rCl.status).json(payload);
    }
    const jCl = safeJson(txtCl);
    const hasAccess = Array.isArray(jCl.records) && jCl.records.length > 0;
    if (!hasAccess) {
      return res.status(403).json({ ok:false, error:'No tienes acceso activo.' });
    }

    // ===== 2) SESSIONS: upsert por email_lc =====
    const nowIso = new Date().toISOString();
    const token = await makeToken(email_lc, SECRET);

    const payloadFields = {
      email_lc: email_lc,   // *** minúsculas en SESSIONS ***
      ts_login: nowIso,
      Token: token,         // opcional, tener la columna creada o comenta esta línea
      DeviceId: deviceId    // opcional, tener la columna creada o comenta esta línea
    };

    // Buscar existente
    const urlFind =
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{email_lc}="${email_lc}"`)}&maxRecords=1`;

    const rFind = await fetch(urlFind, { headers:{ Authorization:`Bearer ${PAT}` } });
    const txtFind = await rFind.text();
    if (!rFind.ok) {
      const payload = { ok:false, error:`Airtable SESSIONS (find) error: HTTP ${rFind.status}` };
      if (debug) payload.detail = safeCut(txtFind, 1000);
      return res.status(502).json(payload);
    }
    const jFind = safeJson(txtFind);
    const existing = (jFind.records || [])[0];

    let rSave, txtSave;
    if (existing) {
      // PATCH
      const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${existing.id}`;
      rSave = await fetch(urlPatch, {
        method:'PATCH',
        headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ fields: payloadFields })
      });
      txtSave = await rSave.text();
    } else {
      // POST
      const urlPost = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}`;
      rSave = await fetch(urlPost, {
        method:'POST',
        headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ records:[{ fields: payloadFields }] })
      });
      txtSave = await rSave.text();
    }

    if (!rSave.ok) {
      const payload = { ok:false, error:`Airtable SESSIONS error: HTTP ${rSave.status}` };
      if (debug) payload.detail = safeCut(txtSave, 2000);
      return res.status(502).json(payload);
    }

    // ===== 3) OK =====
    return res.status(200).json({ ok:true, token, redirect:'/interfaz/' });

  } catch (e) {
    if (debug) return res.status(500).json({ ok:false, error:'Exception', detail:String(e && e.message || e), stack: String(e && e.stack || '') });
    return res.status(500).json({ ok:false, error:'Error HTTP 500' });
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
