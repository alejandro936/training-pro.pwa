// /api/auth/logout.js
// Cierra la sesión: borra la fila del email en sessions (libera el acceso para otro dispositivo)
import { db, dbConfigured, q, readBody } from '../_lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    if (!dbConfigured()) return res.status(500).json({ ok: false, error: 'Config error' });

    const body = await readBody(req);
    const email = body?.email ? String(body.email).trim().toLowerCase() : '';
    if (!email) return res.status(400).json({ ok: false, error: 'Falta el email' });

    const r = await db(`sessions?email_lc=eq.${q(email)}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (!r.ok) return res.status(502).json({ ok: false, error: 'Error al eliminar la sesión' });

    return res.status(200).json({ ok: true, message: 'Sesión eliminada correctamente' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
