/**
 * Lector mínimo de .xlsx, sin dependencias.
 *
 * Un .xlsx es un ZIP con XML adentro. Node trae `zlib`, así que alcanza con
 * leer el directorio central del ZIP, inflar las entradas que interesan
 * (`xl/workbook.xml`, `xl/sharedStrings.xml`, `xl/worksheets/sheetN.xml`) y
 * sacar los valores de celda. Suficiente para leer una planilla de carga;
 * NO pretende soportar formatos, fórmulas ni fechas serializadas.
 */
import { readFileSync } from 'fs';
import { inflateRawSync } from 'zlib';

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Lee el directorio central del ZIP y devuelve las entradas descomprimidas. */
function readZip(buf: Buffer): Map<string, Buffer> {
  // End Of Central Directory: firma 0x06054b50, buscada desde el final.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('No parece un archivo .xlsx (ZIP inválido)');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break; // central file header
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    // El header local repite nombre y extra con largos propios.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    entries.push({
      name,
      data: method === 0 ? raw : inflateRawSync(raw),
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return new Map(entries.map((e) => [e.name, e.data]));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Concatena el texto de todos los <t> de un fragmento (celdas con formato mixto). */
function textOf(xml: string): string {
  const out: string[] = [];
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1]));
  return out.join('');
}

export interface XlsxSheet {
  name: string;
  /** Filas como mapa columna→valor: { A: "1", B: "Ismael soto" }. */
  rows: Array<Record<string, string>>;
}

/**
 * Lee todas las hojas de un .xlsx.
 * Las hojas salen en el orden en que aparecen en el workbook (el mismo de las
 * pestañas), así que `sheets[1]` es la "segunda página".
 */
export function readXlsx(path: string): XlsxSheet[] {
  const zip = readZip(readFileSync(path));

  const workbook = zip.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const sheetNames: string[] = [];
  const nameRe = /<sheet[^>]*name="([^"]*)"/g;
  let nm: RegExpExecArray | null;
  while ((nm = nameRe.exec(workbook))) sheetNames.push(decodeEntities(nm[1]));

  // sharedStrings: las celdas de texto guardan un índice a esta tabla.
  const shared: string[] = [];
  const sst = zip.get('xl/sharedStrings.xml')?.toString('utf8');
  if (sst) {
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let sm: RegExpExecArray | null;
    while ((sm = siRe.exec(sst))) shared.push(textOf(sm[1]));
  }

  const sheets: XlsxSheet[] = [];
  for (let i = 0; i < sheetNames.length; i++) {
    const xml = zip.get(`xl/worksheets/sheet${i + 1}.xml`)?.toString('utf8');
    if (!xml) continue;

    const rows: Array<Record<string, string>> = [];
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(xml))) {
      const cells: Record<string, string> = {};
      const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rm[1]))) {
        const attrs = cm[1];
        const body = cm[2] ?? '';
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        if (!ref) continue;
        const type = /t="([^"]+)"/.exec(attrs)?.[1];

        let value: string;
        if (type === 's') {
          const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? -1);
          value = shared[idx] ?? '';
        } else if (type === 'inlineStr') {
          value = textOf(body);
        } else {
          value = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
        }
        if (value !== '') cells[ref] = value;
      }
      if (Object.keys(cells).length > 0) rows.push(cells);
    }
    sheets.push({ name: sheetNames[i], rows });
  }
  return sheets;
}
