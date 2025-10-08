// /api/auth/validate.js
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

    const { AIRTABLE_PAT, AIRTABLE_BASE_CLIENTES, AIRTABLE_BASE, TABLE_SESSIONS } = process.env;
    const PAT  = AIRTABLE_PAT;
    const BASE = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;
    const TBL  = TABLE_SESSIONS || 'SESSIONS';
    if (!PAT || !BASE || !TBL) return res.status(500).json({ ok:false, error:'Config error' });

    const body = await readJson(req);
    const email = (body && body.email || '').toLowerCase().trim();
    const token = (body && body.token || '').trim();
    const deviceId = (body && body.deviceId || '').trim();

    if (!email || !token || !deviceId) return res.status(400).json({ ok:false, error:'Missing fields' });

    const url =
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}?filterByFormula=${encodeURIComponent(`{email_lc}="${email}"`)}&maxRecords=1`;

    const r = await fetch(url, { headers: { Authorization:`Bearer ${PAT}` } });
    if (!r.ok) return res.status(502).json({ ok:false, error:`Airtable error: ${r.status}` });
    const j = await r.json();
    const row = (j.records || [])[0];
    if (!row) return res.status(401).json({ ok:false, error:'No session' });

    const f = row.fields || {};
    const ok = f.Token && f.Token === token && f.DeviceId && f.DeviceId === deviceId;
    if (!ok) return res.status(401).json({ ok:false, error:'Invalid session' });

    return res.status(200).json({ ok:true });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'Error 500' });
  }
}

/* helpers */
async function readJson(req){ const chunks=[]; for await(const c of req) chunks.push(c); try{ return JSON.parse(Buffer.concat(chunks).toString('utf8')); }catch{ return {}; } }

