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
 
// "remo polea" -> ["remo","polea"]; plural simple: "poleas" -> "polea"
function tokens(q) {
  return norm(q)
    .split(/[^a-z0-9ñ]+/)
    .filter(Boolean)
    .map(t => (t.length >= 4 && t.endsWith('s') ? t.slice(0, -1) : t));
}

// Todas las palabras deben aparecer en el texto, en cualquier orden
function matchesAll(text, toks) {
  const t = norm(text);
  return toks.every(tok => t.includes(tok));
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
 
    const toks = tokens(q);
    if (toks.length) {
      // 1º: nombre + categoría + músculo (sin ruido de las indicaciones)
      const main = rows.filter(x =>
        matchesAll(`${x.ejercicio} ${x.categoria} ${x.musculo}`, toks)
      );
      // 2º: si no hay nada, también se busca dentro de las indicaciones
      rows = main.length
        ? main
        : rows.filter(x =>
            matchesAll(`${x.ejercicio} ${x.categoria} ${x.musculo} ${x.indicaciones}`, toks)
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
