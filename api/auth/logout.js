// /api/auth/logout.js
// Logout robusto: borra todas las filas de SESSIONS del email. Si no puede borrar, deja Token = "".
// Soporta ?debug=1 para ver detalle.

export default async function handler(req, res){
  const debug = req.query && (req.query.debug === '1' || req.query.debug === 'true');

  try{
    if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

    const {
      AIRTABLE_PAT,
      AIRTABLE_BASE_CLIENTES,
      AIRTABLE_BASE,
      TABLE_SESSIONS,
      SESSIONS_EMAIL_FIELD // opcional
    } = process.env;

    const PAT  = AIRTABLE_PAT;
    const BASE = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;
    const TBL  = TABLE_SESSIONS || 'SESSIONS';

    if (!PAT || !BASE || !TBL) {
      const msg = 'Missing env vars (AIRTABLE_PAT / AIRTABLE_BASE_CLIENTES|AIRTABLE_BASE / TABLE_SESSIONS)';
      if (debug) return res.status(500).json({ ok:false, error:msg, detail:{ PAT:!!PAT, BASE, TBL } });
      return res.status(500).json({ ok:false, error:'Config error' });
    }

    // Body
    const body = await readJson(req);
    const email = String(body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ ok:false, error:'Email requerido' });

    const EMAIL_FIELD_NAME = await detectEmailFieldName({ BASE, TBL, PAT, forced: SESSIONS_EMAIL_FIELD });
    const esc = (s) => String(s||'').replace(/"/g, '\\"');

    // 1) Buscar TODAS las filas por email (con paginación)
    const ids = [];
    let offset = null;
    do {
      const url = new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}`);
      url.searchParams.set('filterByFormula', `{${EMAIL_FIELD_NAME}}="${esc(email)}"`);
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      const r = await fetch(url.toString(), { headers:{ Authorization:`Bearer ${PAT}` } });
      const txt = await r.text();
      if (!r.ok) {
        const payload = { ok:false, error:`Airtable find error ${r.status}` };
        if (debug) payload.detail = txt;
        return res.status(502).json(payload);
      }
      const j = safeJson(txt);
      for (const rec of (j.records || [])) ids.push(rec.id);
      offset = j.offset;
    } while (offset);

    if (!ids.length) {
      return res.status(200).json({ ok:true, deleted:0, patched:0 });
    }

    // 2) Intento preferente: borrar en lotes de 10
    let deleted = 0;
    let patchNeeded = [];

    const chunk = (arr, n) => arr.reduce((a,_,i) => (i % n ? a : [...a, arr.slice(i, i+n)]), []);
    for (const group of chunk(ids, 10)) {
      const qs = new URLSearchParams();
      for (const id of group) qs.append('records[]', id);
      const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}?${qs.toString()}`;

      const rDel = await fetch(u, { method:'DELETE', headers:{ Authorization:`Bearer ${PAT}` } });
      const txtDel = await rDel.text();
      if (!rDel.ok) {
        // Si no se puede borrar, haremos fallback a patch
        patchNeeded = patchNeeded.concat(group);
        if (debug) console.warn('Delete failed, will patch:', rDel.status, txtDel);
      } else {
        const jDel = safeJson(txtDel);
        deleted += (jDel?.records || []).length;
      }
    }

    // 3) Fallback: limpiar Token (y opcionalmente ts_logout) de los que no se pudieron borrar
    let patched = 0;
    if (patchNeeded.length) {
      for (const id of patchNeeded) {
        const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}/${id}`;
        const rP = await fetch(urlPatch, {
          method:'PATCH',
          headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ fields: { Token: '', ts_logout: new Date().toISOString() } })
        });
        if (rP.ok) patched++;
      }
    }

    return res.status(200).json({ ok:true, deleted, patched });

  } catch(e){
    if (debug) return res.status(500).json({ ok:false, error:String(e && e.message || e), stack:String(e && e.stack || '') });
    return res.status(500).json({ ok:false, error:'Error HTTP 500' });
  }
}

/* helpers */
async function readJson(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
function safeJson(txt){ try{ return JSON.parse(txt); } catch { return {}; } }

// Detecta el campo email (o usa env SESSIONS_EMAIL_FIELD si está definida)
async function detectEmailFieldName({ BASE, TBL, PAT, forced }){
  if (forced) return forced;
  const candidates = ['email_lc','Email_lc','email','Email','correo','Correo'];
  for (const field of candidates) {
    const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}?filterByFormula=${encodeURIComponent(`{${field}}=""`)}&maxRecords=1`;
    const r = await fetch(u, { headers:{ Authorization:`Bearer ${PAT}` } });
    if (r.ok) return field;
  }
  throw new Error('No pude detectar el campo de email en SESSIONS.');
}

