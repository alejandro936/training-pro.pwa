// /api/_lib/session.js
import crypto from 'crypto';

function b64uToBuf(s){ s = s.replace(/-/g,'+').replace(/_/g,'/'); while (s.length % 4) s += '='; return Buffer.from(s,'base64'); }

export async function verifyToken(tok, secret){
  try{
    const [h,b,sig] = String(tok||'').split('.');
    if (!h || !b || !sig) return { valid:false };
    const expected = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64')
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
    if (expected !== sig) return { valid:false };
    const payload = JSON.parse(Buffer.from(b64uToBuf(b)).toString('utf8'));
    const sub = (payload && payload.sub) ? String(payload.sub).toLowerCase() : '';
    return { valid: !!sub, sub };
  }catch{ return { valid:false }; }
}

async function detectEmailFieldName({ BASE, TBL, PAT, forced }){
  if (forced) return forced;
  const cands = ['email_lc','Email_lc','email','Email','correo','Correo'];
  for (const f of cands){
    const u = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}?filterByFormula=${encodeURIComponent(`{${f}}=""`)}&maxRecords=1`;
    const r = await fetch(u, { headers:{ Authorization:`Bearer ${PAT}` } });
    if (r.ok) return f;
  }
  throw new Error('Email field not found in SESSIONS');
}

export async function requireSession(req){
  const {
    AIRTABLE_PAT: PAT,
    AIRTABLE_BASE_CLIENTES,
    AIRTABLE_BASE,
    TABLE_SESSIONS,
    SECRET,
    SESSIONS_EMAIL_FIELD
  } = process.env;

  const BASE = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;
  const TBL  = TABLE_SESSIONS || 'SESSIONS';

  if (!PAT || !BASE || !TBL || !SECRET) {
    return { ok:false, status:500, error:'Server config error' };
  }

  // 1) Leer token
  const auth = req.headers?.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const token = bearer || '';

  if (!token) return { ok:false, status:401, error:'Missing token' };

  // 2) Verificar firma
  const vt = await verifyToken(token, SECRET);
  if (!vt.valid || !vt.sub) return { ok:false, status:401, error:'Invalid token' };

  // 3) Buscar fila en SESSIONS (email + Token)
  const EMAIL = await detectEmailFieldName({ BASE, TBL, PAT, forced: SESSIONS_EMAIL_FIELD });
  const esc = (s)=> String(s||'').replace(/"/g,'\\"');
  const filter = `AND(LOWER({${EMAIL}})="${esc(vt.sub)}", {Token}="${esc(token)}")`;
  const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL)}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=1`;

  const r = await fetch(url, { headers:{ Authorization:`Bearer ${PAT}` } });
  if (!r.ok) return { ok:false, status:502, error:`Airtable ${r.status}` };
  const j = await r.json();
  const exists = Array.isArray(j.records) && j.records.length > 0;
  if (!exists) return { ok:false, status:401, error:'Session not found' };

  return { ok:true, email: vt.sub, token };
}
