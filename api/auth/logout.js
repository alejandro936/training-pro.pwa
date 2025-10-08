export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { email, deviceId } = req.body;

  if (!email || !deviceId) {
    return res.status(400).json({ ok: false, error: 'Faltan datos: email o deviceId' });
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

  const EMAIL_FIELD = 'email_lc';
  const DEVICE_FIELD = 'DeviceId';
  const LOGOUT_FIELD = 'ts_logout';

  const formula = `AND({${EMAIL_FIELD}}="${email.trim().toLowerCase()}", {${DEVICE_FIELD}}="${deviceId}")`;
  const urlFind = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

  const rFind = await fetch(urlFind, { headers: { Authorization: `Bearer ${PAT}` } });
  const jFind = await rFind.json();
  const record = (jFind.records || [])[0];

  if (!record) {
    return res.status(404).json({ ok: false, error: 'Sesión no encontrada' });
  }

  const urlPatch = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TBL_S)}/${record.id}`;
  const nowIso = new Date().toISOString();

  await fetch(urlPatch, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [LOGOUT_FIELD]: nowIso } }),
  });

  return res.status(200).json({ ok: true, message: 'Sesión cerrada correctamente' });
}
