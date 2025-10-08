// /api/auth/logout.js
// Borra la fila de SESSIONS del email indicado. Así queda libre para volver a iniciar.

export default async function handler(req, res){
  const debug = req.query && (req.query.debug === '1' || req.query.debug === 'true');
  try{
    if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

    const { AIRTABLE_PAT, AIRTABLE_BASE_CLIENTES, AIRTABLE_BASE, TABLE_SESSIONS, SESSIONS_EMAIL_FIELD } = process.env;
    const PAT  = AIRTABLE_PAT;
    const BASE = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;
    const TBL_S = TABLE_SESSIONS || 'SESSIONS';

    const body = await readJson(req);
    const email = String(body?.email||'').trim().toLowerCase();
    if (!email) return res.status(400).json({ ok:false, error:'Email requerido' });

    const EMAIL_FIELD_NAME = await detectEmailFieldName({ BASE, TBL_S, PAT, forced: SESSIONS_EMAIL_FIELD });

    // 1) Buscar la fila por email
    const esc = (s) => String(s||'').replace(/"/g, '\\"');
    const urlFind = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{${EMAIL_FIELD_NAME}}="${esc(email)}"`)}&maxRecords=1`;
    const rFind = await fetch(urlFind, { headers:{ Authorization:`Bearer ${PAT}` }});
    const txtFind = await rFind.text();
    if(!rFind.ok) {
      const payload = { ok:false, error:`Airtable find error ${rFind.status}` };
      if (debug) payload.detail = txtFind;
      return res.status(502).json(payload);
    }
    const jFind = JSON.parse(txtFind || '{}');
    const row = (jFind.records||[])[0];
    if(!row) return res.status(200).json({ ok:true }); // nada que borrar

    // 2) Borrar la fila
    const urlDelete = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${row.id}`;
    const rDel = await fetch(urlDelete, { method:'DELETE', headers:{ Authorization:`Bearer ${PAT}` } });
    const txtDel = await rDel.text();
    if(!rDel.ok) {
      const payload = { ok:false, error:`Airtable delete error ${rDel.status}` };
      if (debug) payload.detail = txtDel;
      return res.status(502).json(payload);
    }
    return res.status(200).json({ ok:true });
  }catch(e){
    if (debug) return res.status(500).json({ ok:false, error:String(e && e.message || e) });
    return res.status(500).json({ ok:false, error:'Error HTTP 500' });
  }

  async function readJson(req){
    const chunks=[]; for await (const c of req) chunks.push(c);
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
  }
  async function detectEmailFieldName({ BASE, TBL_S, PAT, forced }){
    if (forced) return forced;
    const candidates = ['email_lc','Email_lc','email','Email','correo','Correo'];
    for (const field of candidates) {
      const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(`{${field}}=""`)}&maxRecords=1`;
      const r = await fetch(u, { headers:{ Authorization:`Bearer ${PAT}` } });
      if (r.ok) return field;
    }
    throw new Error('No pude detectar el campo de email en SESSIONS.');
  }
}
