import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fitContain } from "./exportLayout";
import notoRegularUrl from "./assets/NotoSerif-Regular.ttf?url";
import notoBoldUrl from "./assets/NotoSerif-Bold.ttf?url";

export type BrandingInfo = {
  studioName: string;
  clientName: string;
  reportDate: string;
};

const ACCENT = "#983000"; // canvas (JPEG) path
const ACCENT_RGB = rgb(0x98 / 255, 0x30 / 255, 0); // pdf-lib path

const fetchBytes = async (url: string): Promise<Uint8Array> =>
  new Uint8Array(await (await fetch(url)).arrayBuffer());

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

// Render the report onto an off-screen canvas (A4 portrait @ ~150dpi).
const renderReportCanvas = (
  source: HTMLCanvasElement,
  branding: BrandingInfo,
): HTMLCanvasElement => {
  const W = 1240;
  const H = 1754;
  const M = 80; // margin

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to create export canvas.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "alphabetic";
  ctx.font = "700 52px Georgia, serif";
  ctx.fillText(branding.studioName, M, M + 50);
  ctx.fillStyle = "#666666";
  ctx.font = "400 26px Georgia, serif";
  ctx.fillText("Vastu Consultation Report", M, M + 92);

  // Info row
  const infoY = M + 150;
  ctx.fillStyle = "#222222";
  ctx.font = "400 24px Arial, sans-serif";
  if (branding.clientName.trim()) {
    ctx.textAlign = "left";
    ctx.fillText(`Client: ${branding.clientName}`, M, infoY);
  }
  ctx.textAlign = "right";
  ctx.fillText(`Date: ${branding.reportDate}`, W - M, infoY);
  ctx.textAlign = "left";

  // Plan image
  const contentTop = infoY + 30;
  const contentBottom = H - M - 30;
  const box = fitContain(
    source.width,
    source.height,
    W - M * 2,
    contentBottom - contentTop,
  );
  const imgX = (W - box.width) / 2;
  ctx.drawImage(source, imgX, contentTop, box.width, box.height);

  // Accent line
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(M, H - M);
  ctx.lineTo(W - M, H - M);
  ctx.stroke();

  return out;
};

export const exportCanvasAsJpeg = async (
  canvas: HTMLCanvasElement,
  fileName: string,
  branding: BrandingInfo,
) => {
  const report = renderReportCanvas(canvas, branding);
  const blob = await new Promise<Blob | null>((resolve) =>
    report.toBlob(resolve, "image/jpeg", 0.95),
  );
  if (!blob) {
    throw new Error("Unable to generate JPEG export.");
  }
  downloadBlob(blob, fileName);
};

export const exportCanvasAsPdf = async (
  canvas: HTMLCanvasElement,
  fileName: string,
  branding: BrandingInfo,
) => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    fetchBytes(notoRegularUrl),
    fetchBytes(notoBoldUrl),
  ]);
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });

  const pageW = 595.28; // A4 portrait, points
  const pageH = 841.89;
  const M = 40;
  const page = doc.addPage([pageW, pageH]);

  // pdf-lib origin is bottom-left; this converts a top-origin y to it.
  const top = (y: number) => pageH - y;

  const black = rgb(0.067, 0.067, 0.067);
  const grey = rgb(0.4, 0.4, 0.4);
  const dark = rgb(0.133, 0.133, 0.133);

  // Header
  page.drawText(branding.studioName, {
    x: M, y: top(M + 26), size: 26, font: bold, color: black,
  });
  page.drawText("Vastu Consultation Report", {
    x: M, y: top(M + 48), size: 13, font: regular, color: grey,
  });

  // Info row
  const infoTop = M + 78;
  if (branding.clientName.trim()) {
    page.drawText(`Client: ${branding.clientName}`, {
      x: M, y: top(infoTop), size: 12, font: regular, color: dark,
    });
  }
  const dateText = `Date: ${branding.reportDate}`;
  const dateWidth = regular.widthOfTextAtSize(dateText, 12);
  page.drawText(dateText, {
    x: pageW - M - dateWidth, y: top(infoTop), size: 12, font: regular, color: dark,
  });

  // Plan image
  const contentTop = infoTop + 16;
  const contentBottom = pageH - M - 16;
  const box = fitContain(
    canvas.width,
    canvas.height,
    pageW - M * 2,
    contentBottom - contentTop,
  );
  const imgX = (pageW - box.width) / 2;
  const jpeg = await doc.embedJpg(canvas.toDataURL("image/jpeg", 0.98));
  page.drawImage(jpeg, {
    x: imgX,
    y: top(contentTop + box.height), // top-left placement → bottom-left origin
    width: box.width,
    height: box.height,
  });

  // Accent line
  page.drawLine({
    start: { x: M, y: M },
    end: { x: pageW - M, y: M },
    thickness: 1.5,
    color: ACCENT_RGB,
  });

  const bytes = await doc.save();
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), fileName);
};
