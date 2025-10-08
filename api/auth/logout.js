// /api/auth/logout.js
// Cierra sesión por email: limpia Token/ts_logout en todas las filas encontradas (case-insensitive)
// y luego intenta borrarlas. Con ?debug=1 devuelve detalles (base, tabla, fórmula, ids).
export default async function handler(req, res){
  const debug = req.query && (req.query.debug === '1' || req.query.debug === 'true');

  try{
    if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

    const {
      AIRTABLE_PAT,
      AIRTABLE_BASE_CLIENTES,
      AIRTABLE_BASE,
      TABLE_SESSIONS
    } = process.env;

    const PAT  = AIRTABLE_PAT;
    const BASE = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;
    const TBL  = TABLE_SESSIONS || 'SESSIONS';

    if (!PAT || !BASE || !TBL) {
      const detail = { PAT: !!PAT, BASE, TBL };
      return res.status(500).json({ ok:false, error:'Config error (PAT/BASE/TABLE_SESSIONS)', detail });
    }

    const body = await readJson(req);
    const emailInput = String(body?.email || '').trim();
    if (!emailInput) return res.status(400).json({ ok:false, error:'Email requerido' });
    const emailLc = emailInput.toLowerCase();
    const esc = (s) => String(s||'').replace(/"/g, '\\"');

    // Fórmula robusta: busca en varios campos habituales (case-insensitive)
    const candidateFields = ['Email','email','Email_lc','email_lc','Correo','correo'];
    const ors = candidateFields.map(f => `LOWER({${f}})="${esc(emailLc)}"`).join(', ');
    const filter = `OR(${ors})`;

    // 1) Buscar TODAS las filas (paginación)
    const ids = [];
    let offset = null, pages = 0;
    do {
      const url = new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}`);
      url.searchParams.set('filterByFormula', filter);
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      const r = await fetch(url.toString(), { headers:{ Authorization:`Bearer ${PAT}` } });
      const txt = await r.text();
      if (!r.ok) {
        const payload = { ok:false, error:`Airtable find error ${r.status}` };
        if (debug) payload.detail = { txt, BASE, TBL, filter };
        return res.status(502).json(payload);
      }
      const j = safeJson(txt);
      (j.records || []).forEach(rec => ids.push(String(rec.id)));
      offset = j.offset;
      pages++;
    } while (offset);

    if (!ids.length) {
      return res.status(200).json({ ok:true, matched:0, patched:0, deleted:0, ...(debug ? { BASE, TBL, filter } : {}) });
    }

    // Helper para trocear en lotes de 10
    const chunk = (arr, n) => arr.reduce((a,_,i)=> (i%n ? a : [...a, arr.slice(i,i+n)]), []);

    // 2) PATCH: limpiar Token y marcar ts_logout
    let patched = 0;
    for (const group of chunk(ids, 10)) {
      const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}`;
      const payload = {
        records: group.map(id => ({ id, fields: { Token: '', ts_logout: new Date().toISOString() } }))
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
        console.warn('PATCH fail', rP.status, await rP.text());
      }
    }

    // 3) DELETE: intentar borrar (opcional)
    let deleted = 0;
    for (const group of chunk(ids, 10)) {
      const qs = new URLSearchParams();
      for (const id of group) qs.append('records[]', id);
      const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}?${qs.toString()}`;
      const rDel = await fetch(u, { method:'DELETE', headers:{ Authorization:`Bearer ${PAT}` } });
      if (rDel.ok) {
        const jDel = await rDel.json();
        deleted += (jDel.records || []).length;
      } else if (debug) {
        console.warn('DELETE fail', rDel.status, await rDel.text());
      }
    }

    return res.status(200).json({
      ok:true,
      matched: ids.length,
      patched,
      deleted,
      ...(debug ? { BASE, TBL, filter, ids } : {})
    });

  } catch(e){
    return res.status(500).json({ ok:false, error:String(e && e.message || e) });
  }
}

/* helpers */
async function readJson(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
function safeJson(txt){ try{ return JSON.parse(txt); } catch { return {}; } }

