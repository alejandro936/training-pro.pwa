// /api/_lib/db.js
// Acceso a Supabase (Postgres) vía su API REST. Sin dependencias.
// Variables en Vercel: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY

export function dbConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function db(path, { method = 'GET', body, prefer } = {}) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  const headers = { apikey: key, 'Content-Type': 'application/json' };
  // Claves antiguas (JWT) también van en Authorization; las nuevas (sb_secret_...) solo en apikey
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  if (prefer) headers.Prefer = prefer;

  const r = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { ok: r.ok, status: r.status, data };
}

export const q = (v) => encodeURIComponent(String(v ?? ''));

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return {}; }
}
