export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).json({ ok: false, error: 'Faltan datos: email o token' });
  }

  const {
    AIRTABLE_PAT,
    AIRTABLE_BASE_CLIENTES,
    AIRTABLE_BASE,
    TABLE_SESSIONS,
  } = process.env;

  const PAT = AIRTABLE_PAT;
  const BASE = AIRTABLE_BASE_CLIENTES || AIRTABLE_BASE;
  const TBL_S = TABLE_SESSIONS || 'SESSIONS';

  const EMAIL_FIELD = 'email_lc';   // Ajusta si tu campo se llama distinto
  const TOKEN_FIELD = 'Token';      // Ajusta si tu campo se llama distinto

  const formula = `AND({${EMAIL_FIELD}}="${email.trim().toLowerCase()}", {${TOKEN_FIELD}}="${token}")`;
  const urlFind = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

  const rFind = await fetch(urlFind, {
    headers: { Authorization: `Bearer ${PAT}` }
  });

  const jFind = await rFind.json();
  const record = (jFind.records || [])[0];

  if (!record) {
    return res.status(404).json({ ok: false, error: 'Sesión no encontrada' });
  }

  const urlDelete = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${record.id}`;

  const rDelete = await fetch(urlDelete, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${PAT}` }
  });

  if (!rDelete.ok) {
    return res.status(500).json({ ok: false, error: 'Error al eliminar la sesión' });
  }

  return res.status(200).json({ ok: true, message: 'Sesión eliminada correctamente' });
}

