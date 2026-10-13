// /api/auth/check.js
// ¿Sigue siendo válida esta sesión? (token firmado + fila en sessions)
import { checkToken } from '../_lib/session.js';
import { readBody } from '../_lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const body = req.method === 'POST' ? await readBody(req) : {};
    const token = body?.token || bearer || req.query?.token || '';

    const r = await checkToken(token);
    if (!r.ok) return res.status(r.status).json({ ok: false, error: r.error });

    return res.status(200).json({ ok: true, email: r.email });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
