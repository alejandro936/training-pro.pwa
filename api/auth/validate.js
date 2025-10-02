export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    const { email, token } = req.body || {};
    const email_lc = String(email || '').trim().toLowerCase();
    if (!email_lc || !token) return res.status(400).json({ ok:false, error:'Faltan parámetros' });

    const PAT   = process.env.AIRTABLE_PAT;
    const BASE  = process.env.AIRTABLE_BASE;
    const TBL_S = process.env.TABLE_SESSIONS || 'SESSIONS';

    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{Email_lc}="${email_lc}"`)}&maxRecords=1`, {
      headers: { Authorization: `Bearer ${PAT}` }
    });
    if (!r.ok) return res.status(502).json({ ok:false, error:'Airtable error' });
    const j = await r.json();
    const rec = (j.records || [])[0];
    const good = !!rec && rec.fields && rec.fields['Token'] === token;

    if (!good) return res.status(401).json({ ok:false, error:'Sesión invalidada en otro dispositivo' });

    // ok
    res.status(200).json({ ok:true, redirect:'/interfaz/' });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
}
