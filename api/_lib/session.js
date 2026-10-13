// /api/_lib/session.js
// Tokens firmados (HS256) + comprobación de sesión en Supabase
import crypto from 'crypto';
import { db, dbConfigured, q } from './db.js';

function b64u(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64uToBuf(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}
function sign(msg, secret) {
  return crypto.createHmac('sha256', secret).update(msg).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function makeToken(sub, secret) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'TP' }));
  const b = b64u(JSON.stringify({ sub, iat: now }));
  return `${h}.${b}.${sign(`${h}.${b}`, secret)}`;
}

export async function verifyToken(tok, secret) {
  try {
    const [h, b, sig] = String(tok || '').split('.');
    if (!h || !b || !sig) return { valid: false };
    if (sign(`${h}.${b}`, secret) !== sig) return { valid: false };
    const payload = JSON.parse(b64uToBuf(b).toString('utf8'));
    const sub = payload && payload.sub ? String(payload.sub).toLowerCase() : '';
    return { valid: !!sub, sub };
  } catch { return { valid: false }; }
}

// Comprueba token: firma válida + existe esa sesión (email + token) en la tabla sessions
export async function checkToken(token) {
  const { SECRET } = process.env;
  if (!SECRET || !dbConfigured()) return { ok: false, status: 500, error: 'Server config error' };
  if (!token) return { ok: false, status: 401, error: 'Missing token' };

  const vt = await verifyToken(token, SECRET);
  if (!vt.valid) return { ok: false, status: 401, error: 'Invalid token' };

  const r = await db(`sessions?select=email_lc&email_lc=eq.${q(vt.sub)}&token=eq.${q(token)}&limit=1`);
  if (!r.ok) return { ok: false, status: 502, error: `DB error ${r.status}` };
  if (!Array.isArray(r.data) || !r.data.length) return { ok: false, status: 401, error: 'Session not found' };

  return { ok: true, email: vt.sub, token };
}

// Para endpoints protegidos (p. ej. /api/ejercicios): lee el token del header Authorization
export async function requireSession(req) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return checkToken(token);
}
