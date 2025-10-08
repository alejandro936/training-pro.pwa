// /api/auth/logout.js
// Cierra sesión por email (case-insensitive):
// 1) Pone Token="" y ts_logout=now en TODAS las filas coincidentes
// 2) Intenta borrar las filas (opcional); si no puede, no pasa nada
export default async function handler(req, res){
  const debug = req.query && (req.query.debug === '1' || req.query.debug === 'true');

  try{
    if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

    const {
      AIRTABLE_PAT,
      AIRTABLE_BASE_CLIENTES,
      AIRTABLE_BASE,
      TABLE_SESSIONS,
      SESSIONS_EMAIL_FIELD // opcional para fijar el nombre del campo de email
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
    const emailInput = String(body?.email || '').trim();
    if (!emailInput) return res.status(400).json({ ok:false, error:'Email requerido' });
    const emailLc = emailInput.toLowerCase();

    // Detectar nombre del campo email en SESSIONS
    const EMAIL_FIELD = await detectEmailFieldName({ BASE, TBL, PAT, forced: SESSIONS_EMAIL_FIELD });

    // 1) Buscar TODAS las filas por email (case-insensitive): LOWER({field})="email_lc"
    const esc = (s) => String(s||'').replace(/"/g, '\\"');
    const filter = `LOWER({${EMAIL_FIELD}})="${esc(emailLc)}"`;

    const ids = [];
    let page = null, total = 0;
    do {
      const url = new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}`);
      url.searchParams.set('filterByFormula', filter);
      url.searchParams.set('pageSize', '100');
      if (page) url.searchParams.set('offset', page);

      const r = await fetch(url.toString(), { headers:{ Authorization:`Bearer ${PAT}` } });
      const txt = await r.text();
      if (!r.ok) {
        const payload = { ok:false, error:`Airtable find error ${r.status}` };
        if (debug) payload.detail = txt;
        return res.status(502).json(payload);
      }
      const j = safeJson(txt);
      const recs = j.records || [];
      total += recs.length;
      for (const rec of recs) ids.push(rec.id);
      page = j.offset;
    } while (page);

    if (!ids.length) {
      return res.status(200).json({ ok:true, matched:0, patched:0, deleted:0 });
    }

    // 2) PATCH: limpiar Token y marcar ts_logout en lotes de 10
    const chunk = (arr, n) => arr.reduce((a,_,i)=> (i%n? a : [...a, arr.slice(i,i+n)]), []);
    let patched = 0, deleted = 0;

    for (const group of chunk(ids, 10)) {
      const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}`;
      const payload = {
        records: group.map(id => ({
          id,
          fields: { Token: '', ts_logout: new Date().toISOString() }
        }))
      };
      const rP = await fetch(urlPatch, {
        method:'PATCH',
        headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      if (rP.ok) {
        const jP = await rP.json();
        patched += (jP.records || []).length;
      } else if (debug) {
        const t = await rP.text();
        console.warn('PATCH fail', rP.status, t);
      }
    }

    // 3) (Opcional) borrar filas si tu PAT/rol lo permite
    for (const group of chunk(ids, 10)) {
      const qs = new URLSearchParams();
      for (const id of group) qs.append('records[]', id);
      const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}?${qs.toString()}`;
      const rDel = await fetch(u, { method:'DELETE', headers:{ Authorization:`Bearer ${PAT}` } });
      if (rDel.ok) {
        const jDel = await rDel.json();
        deleted += (jDel.records || []).length;
      } else if (debug) {
        const t = await rDel.text();
        console.warn('DELETE fail', rDel.status, t);
      }
    }

    return res.status(200).json({ ok:true, matched: ids.length, patched, deleted });

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

