import { createRequire } from 'module';
import { dirname, join, sep } from 'path';
import { readFile } from 'fs/promises';
import Canvas from 'canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Claude 4.7+ models (including Sonnet 5) downscale anything over 2576px on the long
// edge before looking at it, so rendering larger only inflates the request and can
// push a page past the per-image size limit. See
// https://platform.claude.com/docs/en/build-with-claude/vision#resolution-and-token-cost
export const MAX_LONG_EDGE_PX = 2576;
const MAX_SCALE = 2;

const pdfjsDir = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

/**
 * Picks the render scale for a page whose size at scale 1 is width x height:
 * up to MAX_SCALE, but never past MAX_LONG_EDGE_PX on the long edge.
 */
export function renderScale(width: number, height: number): number {
  return Math.min(MAX_SCALE, MAX_LONG_EDGE_PX / Math.max(width, height));
}

class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = Canvas.createCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    // Opaque like pdf-to-img: an alpha channel only adds bytes to a scanned page.
    return { canvas, context: canvas.getContext('2d', { alpha: false }) };
  }

  reset(target: { canvas: Canvas.Canvas }, width: number, height: number) {
    target.canvas.width = Math.max(1, Math.floor(width));
    target.canvas.height = Math.max(1, Math.floor(height));
  }

  destroy(target: { canvas: Canvas.Canvas | null; context: unknown }) {
    if (target.canvas) {
      target.canvas.width = 0;
      target.canvas.height = 0;
    }
    target.canvas = null;
    target.context = null;
  }
}

/** Renders up to maxPages pages of a PDF to PNG buffers, each sized for the model. */
export async function renderPdfPages(pdfPath: string, maxPages: number): Promise<Buffer[]> {
  const canvasFactory = new NodeCanvasFactory();
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(pdfPath)),
    standardFontDataUrl: join(pdfjsDir, 'standard_fonts') + sep,
    cMapUrl: join(pdfjsDir, 'cmaps') + sep,
    cMapPacked: true,
    isEvalSupported: false,
    canvasFactory,
  }).promise;

  try {
    const pages: Buffer[] = [];
    for (let n = 1; n <= Math.min(document.numPages, maxPages); n++) {
      const page = await document.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: renderScale(base.width, base.height) });
      const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
      await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
      pages.push(canvas.toBuffer('image/png'));
      page.cleanup();
    }
    return pages;
  } finally {
    await document.destroy();
  }
}
