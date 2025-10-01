// api/ejercicios.js
import { atList, atGet } from './_lib/airtable.js';

/* ======== helpers ======== */
function norm(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
function extractVideoUrl(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw[0] && raw[0].url) return raw[0].url;
  return '';
}
function mapRow(r) {
  const f = r.fields || {};
  return {
    id:           r.id,
    ejercicio:    f['Ejercicio']        || '',
    categoria:    f['Categoría']        || '',
    indicaciones: f['Indicaciones']     || '',
    video:        extractVideoUrl(f['Vídeo']),
  };
}
function mapDetail(r) {
  const f = r.fields || {};
  return {
    id:           r.id,
    ejercicio:    f['Ejercicio']        || '',
    categoria:    f['Categoría']        || '',
    musculo:      f['Músculo objetivo'] || '',
    indicaciones: f['Indicaciones']     || '',
    video:        extractVideoUrl(f['Vídeo']),
  };
}

/* ======== API ======== */
export default async function handler(req, res) {
  try {
    const BASE = process.env.AIRTABLE_BASE;
    const TBL  = process.env.TABLE_EJERCICIOS_ID || process.env.TABLE_EJERCICIOS;
    if (!process.env.AIRTABLE_PAT || !BASE || !TBL) {
      return res.status(500).json({ ok:false, error:'Faltan variables AIRTABLE_PAT / AIRTABLE_BASE / TABLE_EJERCICIOS(_ID)' });
    }

    if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Method Not Allowed' });

    const { id, q = '', offset = '' } = req.query || {};
    const pageSize = 48;

    // Detalle por id
    if (id) {
      const rec = await atGet({ baseId: BASE, table: TBL, id });
      return res.json({ ok:true, detail: mapDetail(rec) });
    }

    // Lista paginada (sin filtro Airtable; filtramos en server como GAS)
    const out  = await atList({ baseId: BASE, table: TBL, params: { pageSize, offset } });
    let rows   = (out.records || []).map(mapRow);

    const qn = norm(q);
    if (qn) {
      const inc = (s) => norm(s).includes(qn);
      rows = rows.filter(x =>
        inc(x.ejercicio) || inc(x.categoria) || inc(x.indicaciones)
      );
    }

    return res.json({
      ok: true,
      rows,
      hasMore: !!out.offset,
      nextOffset: out.offset || ''
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
