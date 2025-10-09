// /api/auth/check.js
export default async function handler(req, res){
  try{
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ ok:false, error:'Method not allowed' });
    }

    const { AIRTABLE_PAT, AIRTABLE_BASE_CLIENTES, AIRTABLE_BASE, TABLE_SESSIONS, SECRET, SESSIONS_EMAIL_FIELD } = process.env;
    const PAT  = AIRTABLE_PAT;
    const BASE = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;
    const TBL  = TABLE_SESSIONS || 'SESSIONS';
    if (!PAT || !BASE || !TBL || !SECRET) {
      return res.status(500).json({ ok:false, error:'Config error' });
    }

    // Token: Authorization: Bearer xxx  -> o cookie/localStorage via body
    const auth = req.headers.authorization || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const body = await readJson(req);
    const token = (body?.token) || bearer || (req.query?.token) || '';

    if (!token) return res.status(401).json({ ok:false, error:'Missing token' });

    // Verificar firma y extraer sub (email)
    const { valid, sub } = await verifyToken(token, SECRET);
    if (!valid || !sub) return res.status(401).json({ ok:false, error:'Invalid token' });

    // Buscar SESSIONS: email + Token exactos
    const emailLc = String(sub).toLowerCase();
    const EMAIL = await detectEmailFieldName({ BASE, TBL, PAT, forced: SESSIONS_EMAIL_FIELD });
    const esc = (s)=> String(s||'').replace(/"/g,'\\"');
    const filter = `AND(LOWER({${EMAIL}})="${esc(emailLc)}", {Token}="${esc(token)}")`;
    const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=1`;
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${PAT}` } });
    if (!r.ok) return res.status(502).json({ ok:false, error:`Airtable error ${r.status}` });
    const j = await r.json();
    const exists = Array.isArray(j.records) && j.records.length > 0;

    if (!exists) return res.status(401).json({ ok:false, error:'Session not found' });

    return res.status(200).json({ ok:true, email: emailLc });
  }catch(e){
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
}

/* helpers */
async function readJson(req){
  const chunks=[]; for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}
async function detectEmailFieldName({ BASE, TBL, PAT, forced }){
  if (forced) return forced;
  const candidates=['email_lc','Email_lc','email','Email','correo','Correo'];
  for (const f of candidates){
    const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}?filterByFormula=${encodeURIComponent(`{${f}}=""`)}&maxRecords=1`;
    const r = await fetch(u, { headers:{ Authorization:`Bearer ${PAT}` } });
    if (r.ok) return f;
  }
  throw new Error('No email field in SESSIONS');
}

// --- Verificación de tu token HS256 (compatible con makeToken) ---
import crypto from 'crypto';
function b64uToBuf(s){
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}
async function verifyToken(tok, secret){
  try{
    const [h,b,sig] = String(tok).split('.');
    if (!h || !b || !sig) return { valid:false };
    const expected = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64')
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
    if (expected !== sig) return { valid:false };
    const payload = JSON.parse(Buffer.from(b64uToBuf(b)).toString('utf8'));
    const sub = payload?.sub;
    return { valid: !!sub, sub };
  }catch{ return { valid:false }; }
}
