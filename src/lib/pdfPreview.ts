import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';

let workerConfigured = false;

export function setupPdfJs(): typeof pdfjsLib {
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    workerConfigured = true;
  }
  return pdfjsLib;
}

export type PdfRenderSource = { url: string; withCredentials?: boolean } | { data: ArrayBuffer };

/**
 * 将 PDF 逐页渲染为 canvas 并追加到 container（清空 container 现有内容）。
 */
export async function renderPdfInto(
  container: HTMLElement,
  src: PdfRenderSource,
  options?: { maxPages?: number; maxWidth?: number }
): Promise<number> {
  const pdfjs = setupPdfJs();
  const maxPagesCap = options?.maxPages ?? 100;
  const maxW = options?.maxWidth ?? 240;

  const loadingTask =
    'url' in src
      ? pdfjs.getDocument({ url: src.url, withCredentials: src.withCredentials ?? false })
      : pdfjs.getDocument({ data: src.data });

  const pdf = await loadingTask.promise;
  const total = pdf.numPages;
  const n = Math.min(total, maxPagesCap);

  container.innerHTML = '';

  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(maxW / base.width, 2.5);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.display = 'block';
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    canvas.style.borderRadius = '6px';
    if (i > 1) canvas.style.marginTop = '6px';
    await page.render({ canvasContext: ctx, viewport }).promise;
    container.appendChild(canvas);
  }

  await pdf.destroy();
  return n;
}

function escapeHtmlForAttr(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 将详情页中带有 data-admin-pdf-url 的占位节点替换为 pdf.js 多页预览（需已登录，带 Cookie 请求 /api/files）。
 */
export async function hydrateAdminPdfPreviews(root: HTMLElement): Promise<void> {
  const mounts = root.querySelectorAll<HTMLElement>('[data-admin-pdf-url]');
  for (const el of mounts) {
    const url = el.getAttribute('data-admin-pdf-url');
    if (!url) continue;
    const inner = document.createElement('div');
    inner.style.cssText =
      'display:flex;flex-direction:column;gap:6px;align-items:flex-start;max-width:min(360px,100%)';
    el.replaceChildren(inner);
    try {
      await renderPdfInto(inner, { url, withCredentials: true }, { maxWidth: 280, maxPages: 40 });
    } catch {
      inner.innerHTML = `<a href="${escapeHtmlForAttr(url)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline"><i class="icon icon-file-text"></i> 打开 PDF</a>`;
    }
  }
}
