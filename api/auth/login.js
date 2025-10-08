// /api/auth/login.js
// Regla: 1 sesión por email. Si ya hay fila con Token != "" → 409.
// No dependemos de DeviceId. Si llega desde el cliente, lo guardamos; si no, generamos uno (opcional).

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
      SESSIONS_EMAIL_FIELD    // opcional: fuerza el nombre del campo email en SESSIONS
    } = process.env;

    const PAT   = AIRTABLE_PAT;
    const BASE  = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;
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
    const deviceIdClient = body && body.deviceId ? String(body.deviceId).trim() : '';
    const deviceId       = deviceIdClient || makeDeviceId(); // opcional: lo guardamos si está el campo

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
    const urlClientes =
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_C)}?filterByFormula=${encodeURIComponent(formulaClientes)}&maxRecords=1`;

    const rCl = await fetch(urlClientes, { headers: { Authorization:`Bearer ${PAT}` } });
    const txtCl = await rCl.text();
    if (!rCl.ok) {
      const payload = { ok:false, error:`Airtable CLIENTES error: HTTP ${rCl.status}` };
      if (debug) payload.detail = safeCut(txtCl, 1200);
      return res.status(rCl.status).json(payload);
    }
    const jCl = safeJson(txtCl);
    const hasAccess = Array.isArray(jCl.records) && jCl.records.length > 0;
    if (!hasAccess) {
      return res.status(403).json({ ok:false, error:'No tienes acceso activo.' });
    }

    // ===== 2) SESSIONS: bloqueo fuerte por Token =====
    const EMAIL_FIELD_NAME = await detectEmailFieldName({ BASE, TBL_S, PAT, forced: SESSIONS_EMAIL_FIELD });
    const TOKEN_FIELD   = 'Token';
    const DEVICE_FIELD  = 'DeviceId';       // si no existe, Airtable simplemente lo ignorará
    const esc = (s) => String(s||'').replace(/"/g, '\\"');

    // ¿Hay fila con el mismo email y Token no vacío?
    const formulaActiveByToken = `AND(
      {${EMAIL_FIELD_NAME}}="${esc(email_lc)}",
      LEN({${TOKEN_FIELD}})>0
    )`;
    const urlActive =
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(formulaActiveByToken)}&maxRecords=1`;

    const rActive = await fetch(urlActive, { headers:{ Authorization:`Bearer ${PAT}` } });
    const txtActive = await rActive.text();
    if (!rActive.ok) {
      const payload = { ok:false, error:`Airtable SESSIONS (active) error: HTTP ${rActive.status}` };
      if (debug) payload.detail = safeCut(txtActive, 1200);
      return res.status(502).json(payload);
    }
    const jActive = safeJson(txtActive);
    const conflict = Array.isArray(jActive.records) && jActive.records.length > 0;
    if (conflict) {
      return res.status(409).json({
        ok:false,
        error:'Sesión ya iniciada. Cierra sesión para continuar.',
        code:'SESSION_ACTIVE'
      });
    }

    // ===== 3) Upsert (una fila por email) =====
    const nowIso = new Date().toISOString();
    const token  = await makeToken(email_lc, SECRET);

    const fullFields = {
      [EMAIL_FIELD_NAME]: email_lc,
      ts_login: nowIso,
      [TOKEN_FIELD]: token,
      [DEVICE_FIELD]: deviceId
    };
    const minFields = {
      [EMAIL_FIELD_NAME]: email_lc,
      ts_login: nowIso
    };

    // Buscar fila por email (puede existir con Token vacío)
    const urlFind =
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{${EMAIL_FIELD_NAME}}="${esc(email_lc)}"`)}&maxRecords=1`;

    const rFind = await fetch(urlFind, { headers: { Authorization: `Bearer ${PAT}` } });
    const txtFind = await rFind.text();
    if (!rFind.ok) {
      const payload = { ok:false, error:`Airtable SESSIONS (find) error: HTTP ${rFind.status}` };
      if (debug) payload.detail = safeCut(txtFind, 1200);
      return res.status(502).json(payload);
    }
    const jFind = safeJson(txtFind);
    const existing = (jFind.records || [])[0];

    let rSave, txtSave;

    if (existing) {
      // Actualiza la fila existente (Token y, si existe el campo, DeviceId)
      const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${existing.id}`;
      rSave = await fetch(urlPatch, {
        method:'PATCH',
        headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ fields: fullFields })
      });
      txtSave = await rSave.text();

      if (rSave.status === 422) {
        // guarda mínimo y luego Token
        await fetch(urlPatch, {
          method:'PATCH',
          headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ fields: minFields })
        }).catch(()=>{});
        await fetch(urlPatch, {
          method:'PATCH',
          headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ fields: { [TOKEN_FIELD]: token } })
        }).catch(()=>{});
        // intenta DeviceId por separado (si no existe el campo, Airtable lo ignora sin romper)
        await fetch(urlPatch, {
          method:'PATCH',
          headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ fields: { [DEVICE_FIELD]: deviceId } })
        }).catch(()=>{});
      }
    } else {
      // Crea una fila nueva
      const urlPost = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}`;
      rSave = await fetch(urlPost, {
        method:'POST',
        headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ records: [{ fields: fullFields }] })
      });
      txtSave = await rSave.text();

      if (rSave.status === 422) {
        // crea mínima
        await fetch(urlPost, {
          method:'POST',
          headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ records: [{ fields: minFields }] })
        }).catch(()=>{});
        // re-busca y parchea Token y DeviceId
        const rReFind = await fetch(urlFind, { headers:{ Authorization:`Bearer ${PAT}` } });
        const jReFind = await rReFind.json();
        const created = (jReFind.records || [])[0];
        if (created) {
          const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${created.id}`;
          await fetch(urlPatch, {
            method:'PATCH',
            headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
            body: JSON.stringify({ fields: { [TOKEN_FIELD]: token } })
          }).catch(()=>{});
          await fetch(urlPatch, {
            method:'PATCH',
            headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
            body: JSON.stringify({ fields: { [DEVICE_FIELD]: deviceId } })
          }).catch(()=>{});
        }
      }
    }

    if (rSave && !rSave.ok && rSave.status !== 422) {
      const payload = { ok:false, error:`Airtable SESSIONS error: HTTP ${rSave.status}` };
      if (debug) payload.detail = safeCut(txtSave, 2000);
      return res.status(502).json(payload);
    }

    // ===== 4) OK =====
    return res.status(200).json({ ok:true, token, redirect:'/interfaz/' });

  } catch (e) {
    if (debug) return res.status(500).json({ ok:false, error:'Exception', detail:String(e && e.message || e), stack:String(e && e.stack || '') });
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

// Detecta el nombre del campo email en SESSIONS (o usa env SESSIONS_EMAIL_FIELD si está)
async function detectEmailFieldName({ BASE, TBL_S, PAT, forced }){
  if (forced) return forced;
  const candidates = ['email_lc','Email_lc','email','Email','correo','Correo'];
  for (const field of candidates) {
    const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{${field}}=""`)}&maxRecords=1`;
    const r = await fetch(u, { headers:{ Authorization:`Bearer ${PAT}` } });
    if (r.ok) return field;
  }
  throw new Error('No pude detectar el campo de email en SESSIONS. Crea uno: email_lc/Email_lc/email/Email/correo/Correo o define SESSIONS_EMAIL_FIELD.');
}

// Token HS256 simple
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

// Genera un ID de dispositivo (si quieres guardarlo, pero NO lo usamos para el bloqueo)
function makeDeviceId(){
  try {
    if (crypto.randomUUID) return 'srv_' + crypto.randomUUID();
  } catch {}
  return 'srv_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
