// /api/auth/login.js
// Valida email en CLIENTES y crea/actualiza SESSIONS (1 sesión por email).
// Bloquea segundo acceso si ya hay sesión activa en otro dispositivo.
// Soporta ?debug=1 para ver detalle de errores en las respuestas.

import { createSession } from "../_lib/airtable";
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
    const deviceId = getOrCreateDeviceId();

const res = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, deviceId })
});

    // ===== BODY =====
    const body = await readJson(req);
    const email_raw = (body && body.email) ? String(body.email).trim().toLowerCase() : '';
    // Fallback robusto para deviceId (si no viene desde el cliente, generamos uno en servidor)
    const deviceIdClient = body && body.deviceId ? String(body.deviceId).trim() : '';
    const deviceId       = deviceIdClient || makeDeviceId();

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

    // ===== 2) SESSIONS: buscar por email =====
    const EMAIL_FIELD_NAME = await detectEmailFieldName({ BASE, TBL_S, PAT });
    const nowIso = new Date().toISOString();
    const token  = await makeToken(email_lc, SECRET);

    const TOKEN_FIELD   = 'Token';      // ajusta si tu columna se llama distinto
    const DEVICE_FIELD  = 'DeviceId';   // ajusta si tu columna se llama distinto
    const LOGOUT_FIELD  = 'ts_logout';  // opcional: si no existe en tu tabla, simplemente quedará undefined al leer

    const urlFind =
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{${EMAIL_FIELD_NAME}}="${email_lc}"`)}&maxRecords=1`;

    const rFind = await fetch(urlFind, { headers: { Authorization: `Bearer ${PAT}` } });
    const txtFind = await rFind.text();
    if (!rFind.ok) {
      const payload = { ok:false, error:`Airtable SESSIONS (find) error: HTTP ${rFind.status}` };
      if (debug) payload.detail = safeCut(txtFind, 1200);
      return res.status(502).json(payload);
    }
    const jFind = safeJson(txtFind);
    const existing = (jFind.records || [])[0];

    // ===== 2.1) Política de UNA SESIÓN por email =====
    if (existing) {
      const exFields       = existing.fields || {};
      const exDevice       = exFields[DEVICE_FIELD];
      const exToken        = exFields[TOKEN_FIELD];
      const exTsLogout     = exFields[LOGOUT_FIELD]; // puede no existir
      const exIsActive     = !!exToken && !exTsLogout; // activa si hay token y no hay ts_logout

      // Si hay sesión activa y es OTRO dispositivo → bloquear
      if (exIsActive && exDevice && exDevice !== deviceId) {
        const payload = {
          ok: false,
          error: 'Sesión ya iniciada en otro dispositivo. Cierra sesión en el otro dispositivo para continuar.',
          code: 'SESSION_ACTIVE_ELSEWHERE'
        };
        if (debug) payload.detail = { exDevice, deviceId, exIsActive };
        return res.status(409).json(payload);
      }
      // Si no hay device guardado, o es el mismo device, o la sesión está cerrada → continuar y refrescar
    }

    // ===== 2.2) Preparar escritura =====
    const fullFields = {
      [EMAIL_FIELD_NAME]: email_lc,
      ts_login: nowIso,
      [TOKEN_FIELD]: token,
      [DEVICE_FIELD]: deviceId,
      // No tocamos ts_logout aquí (se gestiona en /logout)
    };
    const minFields = {
      [EMAIL_FIELD_NAME]: email_lc,
      ts_login: nowIso
    };

    let rSave, txtSave;

    if (existing) {
      // PATCH full → si 422 reintenta min → luego parchea token/device por separado
      const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${existing.id}`;

      rSave = await fetch(urlPatch, {
        method:'PATCH',
        headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ fields: fullFields })
      });
      txtSave = await rSave.text();

      if (rSave.status === 422) {
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
        await fetch(urlPatch, {
          method:'PATCH',
          headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ fields: { [DEVICE_FIELD]: deviceId } })
        }).catch(()=>{});
      }
    } else {
      // POST full → si 422 POST min → re-busca → PATCH token/device
      const urlPost = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}`;

      rSave = await fetch(urlPost, {
        method:'POST',
        headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ records: [{ fields: fullFields }] })
      });
      txtSave = await rSave.text();

      if (rSave.status === 422) {
        await fetch(urlPost, {
          method:'POST',
          headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ records: [{ fields: minFields }] })
        }).catch(()=>{});

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

    // ===== 3) OK =====
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
