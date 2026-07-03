// api/ejercicios.js
import { requireSession } from './_lib/session';
import ejerciciosData from '../data/ejercicios.json';
 
/* ======== Helpers ======== */
function norm(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
 
function mapRow(e) {
  return {
    id:           e.id,
    ejercicio:    e.nombre          || '',
    categoria:    e.categoria       || '',
    musculo:      e.musculoObjetivo || '',
    indicaciones: e.indicaciones    || '',
    video:        e.video           || '',
  };
}
 
/* ======== API ======== */
export default async function handler(req, res) {
  try {
    // 🔐 Exigir sesión válida + token presente en SESSIONS (sin cambios)
    const gate = await requireSession(req);
    if (!gate.ok) {
      return res.status(gate.status).json({ ok: false, error: gate.error });
    }
 
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }
 
    const { id, q = '', offset = '' } = req.query || {};
    const pageSize = 48;
 
    // Detalle por id
    if (id) {
      const rec = ejerciciosData.find(e => e.id === id);
      if (!rec) {
        return res.status(404).json({ ok: false, error: 'Ejercicio no encontrado' });
      }
      return res.json({ ok: true, detail: mapRow(rec) });
    }
 
    // Lista completa, filtrada en memoria (igual que antes)
    let rows = ejerciciosData.map(mapRow);
 
    const qn = norm(q);
    if (qn) {
      const inc = (s) => norm(s).includes(qn);
      rows = rows.filter(x =>
        inc(x.ejercicio) || inc(x.categoria) || inc(x.indicaciones)
      );
    }
 
    // Paginación en memoria, mismo shape de respuesta que antes
    const start = parseInt(offset || '0', 10) || 0;
    const pageRows = rows.slice(start, start + pageSize);
    const nextOffset = start + pageSize < rows.length ? String(start + pageSize) : '';
 
    return res.json({
      ok: true,
      rows: pageRows,
      hasMore: !!nextOffset,
      nextOffset,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
