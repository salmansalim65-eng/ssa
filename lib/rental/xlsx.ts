/**
 * Reading an .xlsx in the browser, without a library.
 *
 * An xlsx is a ZIP of XML. Both halves of that are things the browser already
 * does — `DecompressionStream` inflates, `DOMParser` reads XML — so the whole
 * reader is a hundred lines here rather than a dependency with a release
 * cadence, a changelog and a supply chain. It reads; it never writes.
 *
 * Everything comes back as STRINGS, exactly as the file stores them. Deciding
 * that 46231 is a date, or that "3,000" is three thousand, belongs to whoever
 * knows what the column means — not here.
 */

const DEC = new TextDecoder();

/** A sheet as a grid of strings: `rows[r][c]`, blanks as "". */
export type SheetGrid = string[][];

/* --------------------------------------------------------------- the zip */

interface ZipEntry {
  name: string;
  /** Offset of the local file header. */
  offset: number;
  compressedSize: number;
  method: number;
}

/**
 * The ZIP's central directory, read from the end backwards.
 *
 * The End Of Central Directory record is at the tail, after a comment of
 * unknown length, so it is found by scanning back for its signature rather
 * than assumed to be the last 22 bytes.
 */
function readDirectory(buf: DataView): ZipEntry[] {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0; i -= 1) {
    if (buf.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file");

  const count = buf.getUint16(eocd + 10, true);
  let p = buf.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.getUint32(p, true) !== 0x02014b50) break;
    const method = buf.getUint16(p + 10, true);
    const compressedSize = buf.getUint32(p + 20, true);
    const nameLen = buf.getUint16(p + 28, true);
    const extraLen = buf.getUint16(p + 30, true);
    const commentLen = buf.getUint16(p + 32, true);
    const offset = buf.getUint32(p + 42, true);
    const name = DEC.decode(new Uint8Array(buf.buffer, buf.byteOffset + p + 46, nameLen));
    entries.push({ name, offset, compressedSize, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(bytes: Uint8Array, buf: DataView, entry: ZipEntry): Promise<string> {
  // The local header repeats the name and extra fields, at their own lengths.
  const nameLen = buf.getUint16(entry.offset + 26, true);
  const extraLen = buf.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const slice = bytes.slice(start, start + entry.compressedSize);

  // 0 is stored, 8 is deflate. Anything else is a zip we did not expect.
  if (entry.method === 0) return DEC.decode(slice);
  if (entry.method !== 8) throw new Error(`Unsupported compression in ${entry.name}`);

  const stream = new Blob([slice as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return DEC.decode(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/* -------------------------------------------------------------- the sheet */

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** One worksheet of a workbook: the name on its tab, and its grid. */
export interface WorkbookSheet {
  name: string;
  grid: SheetGrid;
}

/** Turn one worksheet's XML into a grid of strings. */
function gridOf(doc: Document, shared: string[]): SheetGrid {
  const grid: SheetGrid = [];
  for (const row of Array.from(doc.getElementsByTagName("row"))) {
    const r = Number(row.getAttribute("r") ?? 0) - 1;
    if (r < 0) continue;
    const cells: string[] = [];
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const i = columnIndex(c.getAttribute("r") ?? "A");
      const type = c.getAttribute("t");
      let value = "";
      if (type === "inlineStr") {
        value = Array.from(c.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("");
      } else {
        const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
        value = type === "s" ? (shared[Number(v)] ?? "") : v;
      }
      while (cells.length < i) cells.push("");
      cells[i] = value;
    }
    while (grid.length < r) grid.push([]);
    grid[r] = cells;
  }
  return grid;
}

/**
 * Every worksheet of an xlsx, in the order of the tabs along the bottom.
 *
 * A workbook is not one sheet. The agent sends one file with a tab per month,
 * and reading only the first silently imports August however many times
 * September is asked for — the kind of wrong that looks right. The caller is
 * handed all of them, with their tab names, and asks which one is meant.
 *
 * Shared strings are resolved, inline strings are read, and everything else is
 * left as the file wrote it. A sheet with holes comes back with "" in them, so
 * `rows[r][c]` is always safe to index.
 */
export async function readWorkbook(file: File): Promise<WorkbookSheet[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const buf = new DataView(bytes.buffer);
  const entries = readDirectory(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const parser = new DOMParser();

  // Shared strings: most text in an xlsx lives here, not in the sheet.
  const shared: string[] = [];
  const sharedEntry = byName.get("xl/sharedStrings.xml");
  if (sharedEntry) {
    const doc = parser.parseFromString(await readEntry(bytes, buf, sharedEntry), "application/xml");
    for (const si of Array.from(doc.getElementsByTagName("si"))) {
      // A string may be split across runs; its text is all of them joined.
      shared.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));
    }
  }

  // The workbook's own order, not the order the files sit in the zip.
  const wbEntry = byName.get("xl/workbook.xml");
  const relsEntry = byName.get("xl/_rels/workbook.xml.rels");
  const wanted: { name: string; path: string }[] = [];
  if (wbEntry && relsEntry) {
    const wb = parser.parseFromString(await readEntry(bytes, buf, wbEntry), "application/xml");
    const rels = parser.parseFromString(await readEntry(bytes, buf, relsEntry), "application/xml");
    const targetById = new Map(
      Array.from(rels.getElementsByTagName("Relationship")).map((r) => [
        r.getAttribute("Id") ?? "",
        r.getAttribute("Target") ?? "",
      ]),
    );
    for (const sheet of Array.from(wb.getElementsByTagName("sheet"))) {
      // A hidden tab is one the sender did not mean to send.
      if ((sheet.getAttribute("state") ?? "visible") !== "visible") continue;
      const rid = sheet.getAttribute("r:id") ?? sheet.getAttribute("id") ?? "";
      const path = targetById.get(rid) ?? "";
      if (!path) continue;
      wanted.push({
        name: sheet.getAttribute("name") ?? `Sheet ${wanted.length + 1}`,
        path: path.startsWith("xl/") ? path : `xl/${path.replace(/^\/+/, "")}`,
      });
    }
  }
  if (wanted.length === 0) wanted.push({ name: "Sheet1", path: "xl/worksheets/sheet1.xml" });

  const sheets: WorkbookSheet[] = [];
  for (const w of wanted) {
    const entry = byName.get(w.path);
    if (!entry) continue;
    const doc = parser.parseFromString(await readEntry(bytes, buf, entry), "application/xml");
    sheets.push({ name: w.name, grid: gridOf(doc, shared) });
  }
  if (sheets.length === 0) throw new Error("No worksheet in this file");
  return sheets;
}

/** The first worksheet of an xlsx, as a grid of strings. */
export async function readFirstSheet(file: File): Promise<SheetGrid> {
  return (await readWorkbook(file))[0].grid;
}
