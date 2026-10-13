// /api/auth/login.js
// Regla: 1 sesión por email. Si ya hay una sesión abierta con ese email → 409 (SESSION_ACTIVE).
// La sesión se libera al cerrar sesión (logout) o borrando la fila en Supabase → sessions.
import crypto from 'crypto';
import { db, dbConfigured, q, readBody } from '../_lib/db.js';
import { makeToken } from '../_lib/session.js';

export default async function handler(req, res) {
  const debug = req.query && (req.query.debug === '1' || req.query.debug === 'true');

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const { SECRET } = process.env;
    if (!SECRET || !dbConfigured()) {
      if (debug) return res.status(500).json({ ok: false, error: 'Missing env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SECRET)' });
      return res.status(500).json({ ok: false, error: 'Config error' });
    }

    // ===== BODY =====
    const body = await readBody(req);
    const email_lc = body?.email ? String(body.email).trim().toLowerCase() : '';
    const deviceId = body?.deviceId ? String(body.deviceId).trim() : makeDeviceId();

    if (!email_lc || !email_lc.includes('@')) {
      return res.status(400).json({ ok: false, error: 'Email inválido' });
    }

    // ===== 1) CLIENTES: ¿tiene acceso? =====
    const rCl = await db(`clientes?select=id&email_lc=eq.${q(email_lc)}&acceso_biblioteca=is.true&limit=1`);
    if (!rCl.ok) {
      const payload = { ok: false, error: `DB clientes error: HTTP ${rCl.status}` };
      if (debug) payload.detail = rCl.data;
      return res.status(502).json(payload);
    }
    if (!Array.isArray(rCl.data) || !rCl.data.length) {
      return res.status(403).json({ ok: false, error: 'No tienes acceso activo.' });
    }

    // ===== 2) SESSIONS: crear sesión. Si ya existe una (email es clave única) → 409 =====
    const token = makeToken(email_lc, SECRET);
    const nowIso = new Date().toISOString();

    const rIns = await db('sessions', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { email_lc, token, device_id: deviceId, ts_login: nowIso, updated_at: nowIso },
    });

    if (rIns.status === 409) {
      return res.status(409).json({
        ok: false,
        error: 'Sesión ya iniciada. Cierra sesión para continuar.',
        code: 'SESSION_ACTIVE',
      });
    }
    if (!rIns.ok) {
      const payload = { ok: false, error: `DB sessions error: HTTP ${rIns.status}` };
      if (debug) payload.detail = rIns.data;
      return res.status(502).json(payload);
    }

    // ===== 3) OK =====
    return res.status(200).json({ ok: true, token, redirect: '/interfaz/' });
  } catch (e) {
    if (debug) return res.status(500).json({ ok: false, error: 'Exception', detail: String(e?.message || e) });
    return res.status(500).json({ ok: false, error: 'Error HTTP 500' });
  }
}

function makeDeviceId() {
  try { if (crypto.randomUUID) return 'srv_' + crypto.randomUUID(); } catch {}
  return 'srv_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
