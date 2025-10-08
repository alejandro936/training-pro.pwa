// /api/auth/login.js
// Valida email en CLIENTES y crea/actualiza SESSIONS (1 sesión por email).
// Bloquea un segundo acceso si existe sesión activa en otro dispositivo
// o si existe una sesión activa sin DeviceId (caso legado).
// Soporta ?debug=1 para respuestas con detalle.

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
    const deviceIdClient = body && body.deviceId ? String(body.deviceId).trim() : '';
    const deviceId       = deviceIdClient || makeDeviceId(); // fallback servidor

    if (!email_raw || !email_raw.includes('@')) {
      return res.status(400).json({ ok:false, error:'Email inválido' });
    }
    const email_lc = email_raw;

    // ===== 1) CLIENTES: ¿tiene acceso? =====
    const F = ACCESS; // p.ej. 'Acceso a Biblioteca'
    const formula = `AND(
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
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_C)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

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

   // ===== 2) SESSIONS: bloqueo fuerte (antes de escribir) =====
const EMAIL_FIELD_NAME = await detectEmailFieldName({ BASE, TBL_S, PAT });
const TOKEN_FIELD   = 'Token';
const DEVICE_FIELD  = 'DeviceId';
const LOGOUT_FIELD  = 'ts_logout'; // idealmente existe; si no, caemos al fallback

const esc = (s) => String(s||'').replace(/"/g, '\\"');

// Helpers para construir fórmulas
function activeCond(useLogout){
  return useLogout
    ? `AND(LEN({${TOKEN_FIELD}})>0, OR({${LOGOUT_FIELD}}="", IS_BLANK({${LOGOUT_FIELD}})))`
    : `LEN({${TOKEN_FIELD}})>0`;
}
function formulaActiveOther(email_lc, deviceId, useLogout){
  return `AND(
    {${EMAIL_FIELD_NAME}}="${esc(email_lc)}",
    ${activeCond(useLogout)},
    LEN({${DEVICE_FIELD}})>0,
    {${DEVICE_FIELD}} != "${esc(deviceId)}"
  )`;
}
function formulaActiveNoDevice(email_lc, useLogout){
  return `AND(
    {${EMAIL_FIELD_NAME}}="${esc(email_lc)}",
    ${activeCond(useLogout)},
    OR({${DEVICE_FIELD}}="", IS_BLANK({${DEVICE_FIELD}}))
  )`;
}

// Intenta con ts_logout; si 422, reintenta sin ts_logout
async function queryOnce(formula){
  const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const r = await fetch(u, { headers:{ Authorization:`Bearer ${PAT}` } });
  const txt = await r.text();
  return { ok: r.ok, status: r.status, json: safeJson(txt), txt };
}

async function checkConflicts(){
  // Intento 1: con ts_logout
  let useLogout = true;

  // ---- ACTIVE OTHER ----
  let f1 = formulaActiveOther(email_lc, deviceId, useLogout);
  let r1 = await queryOnce(f1);
  if (!r1.ok && r1.status === 422) {
    useLogout = false; // fallback
    f1 = formulaActiveOther(email_lc, deviceId, useLogout);
    r1 = await queryOnce(f1);
  }
  if (!r1.ok) {
    const payload = { ok:false, error:`Airtable SESSIONS (active-other) error: HTTP ${r1.status}` };
    if (debug) payload.detail = safeCut(r1.txt, 1200);
    return { error: payload };
  }
  const conflictOther = Array.isArray(r1.json.records) && r1.json.records.length > 0;
  if (conflictOther) {
    return { conflict: { code:'SESSION_ACTIVE_ELSEWHERE', msg:'Sesión ya iniciada en otro dispositivo. Cierra sesión allí para continuar.' } };
  }

  // ---- ACTIVE NO DEVICE ----
  let f2 = formulaActiveNoDevice(email_lc, useLogout);
  let r2 = await queryOnce(f2);
  if (!r2.ok && r2.status === 422 && useLogout) {
    // si la primera parte fue con logout y aquí falla, reintenta sin logout
    f2 = formulaActiveNoDevice(email_lc, false);
    r2 = await queryOnce(f2);
  }
  if (!r2.ok) {
    const payload = { ok:false, error:`Airtable SESSIONS (active-nodevice) error: HTTP ${r2.status}` };
    if (debug) payload.detail = safeCut(r2.txt, 1200);
    return { error: payload };
  }
  const conflictNoDevice = Array.isArray(r2.json.records) && r2.json.records.length > 0;
  if (conflictNoDevice) {
    return { conflict: { code:'SESSION_ACTIVE_WITHOUT_DEVICE', msg:'Sesión activa detectada. Por seguridad, cierra sesión antes de entrar desde otro dispositivo.' } };
  }

  return {}; // sin conflictos
}

// Ejecuta el chequeo
const chk = await checkConflicts();
if (chk.error) {
  return res.status(502).json(chk.error); // incluye detail si ?debug=1
}
if (chk.conflict) {
  return res.status(409).json({ ok:false, error: chk.conflict.msg, code: chk.conflict.code });
}


    // ===== 3) Crear/actualizar sesión =====
    const nowIso = new Date().toISOString();
    const token  = await makeToken(email_lc, SECRET);

    const fullFields = {
      [EMAIL_FIELD_NAME]: email_lc,
      ts_login: nowIso,
      [TOKEN_FIELD]: token,
      [DEVICE_FIELD]: deviceId
      // No tocamos ts_logout aquí
    };
    const minFields = {
      [EMAIL_FIELD_NAME]: email_lc,
      ts_login: nowIso
    };

    const urlFindByEmail =
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{${EMAIL_FIELD_NAME}}="${esc(email_lc)}"`)}&maxRecords=1`;

    const rFind = await fetch(urlFindByEmail, { headers: { Authorization: `Bearer ${PAT}` } });
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
      const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${existing.id}`;
      rSave = await fetch(urlPatch, {
        method:'PATCH',
        headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ fields: fullFields })
      });
      txtSave = await rSave.text();

      if (rSave.status === 422) {
        // guarda lo mínimo
        await fetch(urlPatch, {
          method:'PATCH',
          headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ fields: minFields })
        }).catch(()=>{});
        // y parchea token y device por separado
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
    } else {
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
        // re-busca y parchea token/device
        const rReFind = await fetch(urlFindByEmail, { headers:{ Authorization:`Bearer ${PAT}` } });
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

    // ===== 4) Verificación post-save (imprescindible) =====
    const rVerify = await fetch(urlFindByEmail, { headers:{ Authorization:`Bearer ${PAT}` } });
    if (!rVerify.ok) {
      return res.status(502).json({ ok:false, error:`Airtable verify error ${rVerify.status}` });
    }
    const jVerify = await rVerify.json();
    const row = (jVerify.records||[])[0];
    const fields = row?.fields || {};
    if (!fields[TOKEN_FIELD] || !fields[DEVICE_FIELD]) {
      // no devolvemos 200 si no tenemos consistencia
      return res.status(502).json({
        ok:false,
        error:'No se pudo persistir DeviceId/Token de forma consistente.',
        code:'DEVICE_NOT_PERSISTED'
      });
    }

    // ===== 5) OK =====
    const nowToken = await makeToken(email_lc, SECRET); // opcional: ya lo generamos arriba
    return res.status(200).json({ ok:true, token: nowToken, redirect:'/interfaz/' });

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

// Detecta si el campo email de SESSIONS es 'email_lc' o 'Email_lc'
async function detectEmailFieldName({ BASE, TBL_S, PAT }){
  const test = async (field) => {
    const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{${field}}=""`)}&maxRecords=1`;
    const r = await fetch(u, { headers:{ Authorization:`Bearer ${PAT}` } });
    return r.ok ? field : null;
  };
  return (await test('email_lc')) || (await test('Email_lc')) || 'email_lc';
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

// Genera ID de dispositivo (servidor) si no vino desde el cliente
function makeDeviceId(){
  try {
    if (crypto.randomUUID) return 'srv_' + crypto.randomUUID();
  } catch {}
  return 'srv_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
