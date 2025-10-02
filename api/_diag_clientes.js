// /api/_diag_clientes.js
export default async function handler(req, res) {
  try {
    const {
      AIRTABLE_PAT,
      AIRTABLE_BASE_CLIENTES,
      AIRTABLE_BASE, // fallback
      TABLE_CLIENTES_ID,
      TABLE_CLIENTES,
    } = process.env;

    const PAT    = AIRTABLE_PAT;
    const BASE_C = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;
    const TBL_C  = TABLE_CLIENTES_ID || TABLE_CLIENTES || 'CLIENTES';

    if (!PAT)  return res.status(500).json({ok:false, error:'No AIRTABLE_PAT'});
    if (!BASE_C) return res.status(500).json({ok:false, error:'No AIRTABLE_BASE_CLIENTES'});
    if (!TBL_C)  return res.status(500).json({ok:false, error:'No TABLE_CLIENTES_ID/TABLE_CLIENTES'});

    const url = `https://api.airtable.com/v0/${BASE_C}/${encodeURIComponent(TBL_C)}?maxRecords=1`;
    const r   = await fetch(url, { headers:{ Authorization:`Bearer ${PAT}` } });

    const text = await r.text();
    return res.status(200).json({
      ok: r.ok,
      http: r.status,
      using: { BASE_C, TBL_C },
      sample: safeCut(text, 500)
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
function safeCut(s, n){ s=String(s||''); return s.length>n? s.slice(0,n)+'…': s; }
