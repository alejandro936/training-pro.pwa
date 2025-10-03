// /api/_diag_sessions.js
// Pruebas de lectura/escritura en la tabla SESSIONS para ver el error exacto.

export default async function handler(req, res) {
  const {
    AIRTABLE_PAT,
    AIRTABLE_BASE_CLIENTES,
    AIRTABLE_BASE,
    TABLE_SESSIONS,
  } = process.env;

  const PAT    = AIRTABLE_PAT;
  const BASE   = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;
  const TBL_S  = TABLE_SESSIONS || 'SESSIONS';

  if (!PAT || !BASE || !TBL_S) {
    return res.status(500).json({ ok: false, error: 'Faltan env vars (PAT/BASE/TABLE_SESSIONS)' });
  }

  const act = (req.query.action || 'find').toLowerCase();
  const email = (req.query.email || 'diag@example.com').toLowerCase();
  const nowIso = new Date().toISOString();

  try {
    if (act === 'find') {
      const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?maxRecords=1`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` }});
      const txt = await r.text();
      return res.status(r.status).json({ ok: r.ok, step: 'find', status: r.status, body: safe(txt) });
    }

    if (act === 'insert') {
      const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: { Email_lc: email, ts_login: nowIso } }] })
      });
      const txt = await r.text();
      return res.status(r.status).json({ ok: r.ok, step: 'insert', status: r.status, body: safe(txt) });
    }

    if (act === 'patch') {
      // Intenta encontrar un registro y actualizarlo
      const fUrl = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{Email_lc}="${email}"`)}&maxRecords=1`;
      const f = await fetch(fUrl, { headers: { Authorization: `Bearer ${PAT}` }});
      const fJson = await f.json();
      if (!f.ok || !fJson.records || !fJson.records[0]) {
        return res.status(404).json({ ok:false, step: 'patch-find', detail: fJson });
      }
      const id = fJson.records[0].id;
      const pUrl = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${id}`;
      const r = await fetch(pUrl, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { ts_login: nowIso } })
      });
      const txt = await r.text();
      return res.status(r.status).json({ ok: r.ok, step: 'patch', status: r.status, body: safe(txt) });
    }

    return res.status(400).json({ ok:false, error:'Acción inválida. Usa ?action=find|insert|patch&email=...' });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
}

function safe(s) {
  s = String(s || '');
  try { return JSON.parse(s); } catch { return s.slice(0, 1000); }
}
