// /api/auth/validate.js
export default async function handler(req, res){
  try{
    if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

    const { AIRTABLE_PAT, AIRTABLE_BASE_CLIENTES, AIRTABLE_BASE, TABLE_SESSIONS } = process.env;
    const PAT   = AIRTABLE_PAT;
    const BASE  = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;
    const TBL_S = TABLE_SESSIONS || 'SESSIONS';

    const body = await readJson(req);
    const email = (body.email||'').toLowerCase().trim();
    const token = String(body.token||'');

    if(!PAT || !BASE || !TBL_S) return res.status(500).json({ ok:false, error:'Config error' });
    if(!email || !token)        return res.status(400).json({ ok:false, error:'Bad request' });

    // detecta nombre del campo email
    const EMAIL_FIELD_NAME = await detectEmailFieldName({ BASE, TBL_S, PAT });

    // busca la fila de sesión
    const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?maxRecords=1&filterByFormula=${encodeURIComponent(`{${EMAIL_FIELD_NAME}}="${email}"`)}`;
    const r   = await fetch(url, { headers:{ Authorization:`Bearer ${PAT}` } });
    if(!r.ok) return res.status(502).json({ ok:false, error:`Airtable error ${r.status}` });
    const j = await r.json();
    const row = (j.records||[])[0];
    if(!row) return res.status(401).json({ ok:false, error:'No session' });

    const saved = (row.fields && (row.fields.Token || row.fields.token || '')) + '';
    if (!saved || saved !== token) {
      return res.status(401).json({ ok:false, error:'Invalid token' });
    }

    return res.status(200).json({ ok:true });
  }catch(e){
    return res.status(500).json({ ok:false, error:String(e && e.message || e) });
  }
}

async function readJson(req){ const chunks=[]; for await (const c of req) chunks.push(c); try{ return JSON.parse(Buffer.concat(chunks).toString('utf8')); }catch{ return {}; } }
async function detectEmailFieldName({ BASE, TBL_S, PAT }){
  const test = async (field) => {
    const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{${field}}=""`)}&maxRecords=1`;
    const r = await fetch(u, { headers:{ Authorization:`Bearer ${PAT}` } });
    return r.ok ? field : null;
  };
  return (await test('email_lc')) || (await test('Email_lc')) || 'email_lc';
}

