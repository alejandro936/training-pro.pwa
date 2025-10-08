// /api/auth/logout.js
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

    if (!email) return res.status(400).json({ ok:false, error:'Missing email' });

    // busca sesión por email y la invalida
    const findUrl =
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}?filterByFormula=${encodeURIComponent(`{email_lc}="${email}"`)}&maxRecords=10`;
    const rFind = await fetch(findUrl, { headers:{ Authorization:`Bearer ${PAT}` } });
    if (!rFind.ok) return res.status(502).json({ ok:false, error:`Airtable error: ${rFind.status}` });
    const j = await rFind.json();

    if (Array.isArray(j.records) && j.records.length){
      const batch = {
        records: j.records.map(r => ({ id:r.id, fields:{ Token:'', DeviceId:'' } }))
      };
      await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}`, {
        method:'PATCH',
        headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
        body: JSON.stringify(batch)
      });
    }

    return res.status(200).json({ ok:true });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'Error 500' });
  }
}

/* helpers */
async function readJson(req){ const chunks=[]; for await(const c of req) chunks.push(c); try{ return JSON.parse(Buffer.concat(chunks).toString('utf8')); }catch{ return {}; } }
