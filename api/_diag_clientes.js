// /api/_diag_clientes.js
// Diagnóstico de credenciales/variables para la base de CLIENTES en Airtable

export default async function handler(req, res) {
  try {
    const PAT   = process.env.AIRTABLE_PAT || '';
    const BASEC = process.env.AIRTABLE_BASE_CLIENTES || ''; // <— base donde están CLIENTES y SESSIONS
    const TIDC  = process.env.TABLE_CLIENTES_ID || '';
    const TNAM  = process.env.TABLE_CLIENTES || '';
    const TABLE = TIDC || TNAM || ''; // acepta id de tabla o nombre

    if (!PAT || !BASEC || !TABLE) {
      return res.status(200).json({
        ok: false,
        reason: 'MISSING_ENV',
        missing: {
          AIRTABLE_PAT: !!PAT,
          AIRTABLE_BASE_CLIENTES: !!BASEC,
          TABLE_CLIENTES_ID_or_TABLE_CLIENTES: !!TABLE,
        },
      });
    }

    const url = `https://api.airtable.com/v0/${BASEC}/${encodeURIComponent(TABLE)}?maxRecords=1`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${PAT}` },
    });

    const http = r.status;
    let body = null;
    try { body = await r.json(); } catch { body = null; }

    // Si 2xx devolvemos un pequeño sample para confirmar acceso
    if (r.ok) {
      const sample = (body && body.records && body.records[0]) || null;
      return res.status(200).json({
        ok: true,
        http,
        using: { BASE_C: BASEC, TABLE_C: TABLE },
        sample: sample ? { id: sample.id, fields: Object.keys(sample.fields || {}).slice(0, 6) } : null,
      });
    }

    // Errores típicos: 401/403/404…
    return res.status(200).json({
      ok: false,
      http,
      using: { BASE_C: BASEC, TABLE_C: TABLE },
      airtable_error: body,
    });
  } catch (err) {
    return res.status(200).json({ ok: false, reason: 'EXCEPTION', error: String(err) });
  }
}
