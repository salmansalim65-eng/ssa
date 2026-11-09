/**
 * A PDF bank statement as a grid.
 *
 * A PDF has no table. It has words with coordinates, and the table is
 * something the eye does — so that is what is done here: words on the same
 * line are gathered into a row, and a gap wide enough to be a column break
 * ends a cell. It is the same reading a person does, written down.
 *
 * pdfjs is loaded only when a PDF is actually opened, so the page costs
 * nothing until somebody uses it.
 */

export type PdfGrid = string[][];

/** Words closer than this share a cell; further apart, a column break. */
const COLUMN_GAP = 8;
/** Items within this many points of each other are on the same line. */
const LINE_TOLERANCE = 3;

interface Word {
  text: string;
  x: number;
  y: number;
  width: number;
}

export async function gridFromPdf(file: File): Promise<PdfGrid> {
  const pdfjs = await import("pdfjs-dist");
  // The worker is served from the same package; without this it tries to fetch
  // one from a CDN the browser may not be allowed to reach.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const grid: PdfGrid = [];

  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    const words: Word[] = [];
    for (const item of content.items) {
      const text = (item as { str?: string }).str ?? "";
      if (!text.trim()) continue;
      const tr = (item as { transform?: number[] }).transform ?? [];
      words.push({
        text,
        x: tr[4] ?? 0,
        // PDF y grows upwards; negate so sorting reads top to bottom.
        y: -(tr[5] ?? 0),
        width: (item as { width?: number }).width ?? 0,
      });
    }
    words.sort((a, b) => a.y - b.y || a.x - b.x);

    // Gather into lines, then lines into cells.
    let line: Word[] = [];
    let lineY: number | null = null;
    const flush = () => {
      if (line.length === 0) return;
      grid.push(toCells(line));
      line = [];
    };
    for (const word of words) {
      if (lineY === null || Math.abs(word.y - lineY) <= LINE_TOLERANCE) {
        line.push(word);
        lineY = lineY ?? word.y;
      } else {
        flush();
        line = [word];
        lineY = word.y;
      }
    }
    flush();
  }

  return grid;
}

/** One line's words, split into cells wherever the gap is wide enough. */
function toCells(line: Word[]): string[] {
  const sorted = [...line].sort((a, b) => a.x - b.x);
  const cells: string[] = [];
  let cell = sorted[0].text;
  let endOfCell = sorted[0].x + sorted[0].width;

  for (let i = 1; i < sorted.length; i += 1) {
    const word = sorted[i];
    if (word.x - endOfCell > COLUMN_GAP) {
      cells.push(cell.trim());
      cell = word.text;
    } else {
      // Words the PDF split mid-phrase: a space unless one is already there.
      cell += /\s$/.test(cell) || /^\s/.test(word.text) ? word.text : ` ${word.text}`;
    }
    endOfCell = word.x + word.width;
  }
  cells.push(cell.trim());
  return cells;
}
