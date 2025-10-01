// api/validate-token.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { email: emailRaw } = req.body || {};
    const email = String(emailRaw || '').trim().toLowerCase();
    if (!email || !/@/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Email no válido' });
    }

    const PAT     = process.env.AIRTABLE_PAT;
    const BASE_ID = process.env.AIRTABLE_BASE_CLIENTES;
    const TABLE   = process.env.TABLE_CLIENTES_ID || process.env.TABLE_CLIENTES || 'CLIENTES';
    const SECRET  = process.env.SECRET;
    const DAYS    = Number(process.env.SESSION_DAYS || '30');  // 0 = sin caducidad
    const BIB_URL = process.env.BIB_WEBAPP_URL; // p. ej. https://tudominio/biblioteca/ o URL externa

    if (!PAT || !BASE_ID || !TABLE || !SECRET || !BIB_URL) {
      return res.status(500).json({ ok: false, error: 'Config incompleta en variables de entorno' });
    }

    // --- Consulta Airtable ---
    const formula = `AND(
      OR(LOWER({Email})="${email}", {Email_lc}="${email}"),
      OR({Acceso a Biblioteca}=1, {Acceso a Biblioteca}="Sí", {Acceso a Biblioteca}="Si")
    )`;

    const atUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
    const atRes = await fetch(atUrl, { headers: { Authorization: `Bearer ${PAT}` } });
    if (!atRes.ok) {
      const txt = await atRes.text();
      return res.status(atRes.status).json({ ok: false, error: `Airtable ${atRes.status}: ${txt}` });
    }
    const data = await atRes.json();
    const ok = (data.records || []).length > 0;
    if (!ok) {
      return res.status(403).json({ ok: false, error: 'No tienes acceso activo.' });
    }

    // --- Firma token HS256 simple ---
    const token = signToken({ sub: email }, SECRET, DAYS);
    const redirect = `${BIB_URL}?tk=${encodeURIComponent(token)}`;

    return res.status(200).json({ ok: true, token, redirect });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}

function signToken(payload, secret, days) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'TP' };
  const body   = { ...payload, iat: now };
  if (days > 0) body.exp = now + days * 86400;

  const h = b64u(JSON.stringify(header));
  const b = b64u(JSON.stringify(body));
  const msg = `${h}.${b}`;
  const sig = b64u(hmacSha256(msg, secret));
  return `${h}.${b}.${sig}`;
}

function b64u(input) {
  const s = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return s.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function hmacSha256(message, secret) {
  return require('crypto').createHmac('sha256', secret).update(message).digest();
}
