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

// Shared palette (hex for canvas, normalized rgb for pdf-lib).
const COLORS = {
  band: "#7a2600", // deep maroon header band
  bandHex: "#7a2600",
  gold: "#c69a4e", // accent rule
  cream: "#f6efe3", // text on band
  creamDim: "#e7d8c2",
  label: "#9a8f80", // small uppercase labels
  value: "#241f1a", // primary text
  hairline: "#e4ddd1",
  frame: "#d8cfc0",
  footer: "#8a8175",
} as const;

const hexToRgb = (hex: string) =>
  rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );

const fetchBytes = async (url: string): Promise<Uint8Array> =>
  new Uint8Array(await (await fetch(url)).arrayBuffer());

const spaced = (text: string) => text.toUpperCase().split("").join("  ");

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
  const M = 96; // side margin
  const bandH = 188;

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to create export canvas.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header band
  ctx.fillStyle = COLORS.band;
  ctx.fillRect(0, 0, W, bandH);
  ctx.fillStyle = COLORS.gold;
  ctx.fillRect(0, bandH, W, 5);

  // Studio name + subtitle
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLORS.cream;
  ctx.font = "700 56px Georgia, 'Times New Roman', serif";
  ctx.fillText(branding.studioName, M, 96);
  ctx.fillStyle = COLORS.creamDim;
  ctx.font = "400 21px Georgia, serif";
  ctx.save();
  ctx.letterSpacing = "4px";
  ctx.fillText("VASTU CONSULTATION REPORT", M, 138);
  ctx.restore();

  // Info row: CLIENT (left) / DATE (right)
  const labelY = bandH + 70;
  const valueY = bandH + 104;
  ctx.textAlign = "left";
  if (branding.clientName.trim()) {
    ctx.fillStyle = COLORS.label;
    ctx.font = "700 17px Arial, sans-serif";
    ctx.save();
    ctx.letterSpacing = "2px";
    ctx.fillText("CLIENT", M, labelY);
    ctx.restore();
    ctx.fillStyle = COLORS.value;
    ctx.font = "400 30px Georgia, serif";
    ctx.fillText(branding.clientName, M, valueY);
  }
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.label;
  ctx.font = "700 17px Arial, sans-serif";
  ctx.save();
  ctx.letterSpacing = "2px";
  ctx.fillText("DATE", W - M, labelY);
  ctx.restore();
  ctx.fillStyle = COLORS.value;
  ctx.font = "400 30px Georgia, serif";
  ctx.fillText(branding.reportDate, W - M, valueY);
  ctx.textAlign = "left";

  // Hairline under info
  const ruleY = bandH + 134;
  ctx.strokeStyle = COLORS.hairline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, ruleY);
  ctx.lineTo(W - M, ruleY);
  ctx.stroke();

  // Plan image (fit + center within content area), with subtle frame
  const contentTop = ruleY + 40;
  const contentBottom = H - 150;
  const box = fitContain(source.width, source.height, W - M * 2, contentBottom - contentTop);
  const imgX = (W - box.width) / 2;
  const imgY = contentTop + (contentBottom - contentTop - box.height) / 2;
  ctx.drawImage(source, imgX, imgY, box.width, box.height);
  ctx.strokeStyle = COLORS.frame;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(imgX, imgY, box.width, box.height);

  // Footer
  const footerY = H - 80;
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, footerY);
  ctx.lineTo(W - M, footerY);
  ctx.stroke();
  ctx.fillStyle = COLORS.footer;
  ctx.font = "400 18px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText(
    `Prepared by ${branding.studioName}  ·  Confidential`,
    W / 2,
    footerY + 34,
  );
  ctx.textAlign = "left";

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
  const M = 46;
  const bandH = 90;
  const page = doc.addPage([pageW, pageH]);

  // pdf-lib origin is bottom-left; convert a top-origin y to it.
  const top = (y: number) => pageH - y;

  const band = hexToRgb(COLORS.band);
  const gold = hexToRgb(COLORS.gold);
  const cream = hexToRgb(COLORS.cream);
  const creamDim = hexToRgb(COLORS.creamDim);
  const label = hexToRgb(COLORS.label);
  const value = hexToRgb(COLORS.value);
  const hairline = hexToRgb(COLORS.hairline);
  const frame = hexToRgb(COLORS.frame);
  const footer = hexToRgb(COLORS.footer);

  // Header band + gold accent strip
  page.drawRectangle({ x: 0, y: top(bandH), width: pageW, height: bandH, color: band });
  page.drawRectangle({ x: 0, y: top(bandH) - 2.5, width: pageW, height: 2.5, color: gold });

  // Studio name + subtitle
  page.drawText(branding.studioName, {
    x: M, y: top(46), size: 27, font: bold, color: cream,
  });
  page.drawText(spaced("Vastu Consultation Report"), {
    x: M, y: top(68), size: 9.5, font: regular, color: creamDim,
  });

  // Info row
  const labelY = bandH + 32;
  const valueY = bandH + 50;
  if (branding.clientName.trim()) {
    page.drawText(spaced("Client"), { x: M, y: top(labelY), size: 8, font: bold, color: label });
    page.drawText(branding.clientName, { x: M, y: top(valueY), size: 14, font: regular, color: value });
  }
  const dateLabel = spaced("Date");
  const dateLabelW = bold.widthOfTextAtSize(dateLabel, 8);
  page.drawText(dateLabel, { x: pageW - M - dateLabelW, y: top(labelY), size: 8, font: bold, color: label });
  const dateW = regular.widthOfTextAtSize(branding.reportDate, 14);
  page.drawText(branding.reportDate, { x: pageW - M - dateW, y: top(valueY), size: 14, font: regular, color: value });

  // Hairline under info
  const ruleY = bandH + 64;
  page.drawLine({ start: { x: M, y: top(ruleY) }, end: { x: pageW - M, y: top(ruleY) }, thickness: 0.8, color: hairline });

  // Plan image (fit + center vertically in content area) with frame
  const contentTop = ruleY + 20;
  const contentBottom = pageH - 72;
  const box = fitContain(canvas.width, canvas.height, pageW - M * 2, contentBottom - contentTop);
  const imgX = (pageW - box.width) / 2;
  const imgTopY = contentTop + (contentBottom - contentTop - box.height) / 2;
  const jpeg = await doc.embedJpg(canvas.toDataURL("image/jpeg", 0.98));
  page.drawImage(jpeg, { x: imgX, y: top(imgTopY + box.height), width: box.width, height: box.height });
  page.drawRectangle({
    x: imgX, y: top(imgTopY + box.height), width: box.width, height: box.height,
    borderColor: frame, borderWidth: 0.8,
  });

  // Footer: gold rule + centered note (top-origin y via top())
  const footerY = pageH - 50;
  page.drawLine({ start: { x: M, y: top(footerY) }, end: { x: pageW - M, y: top(footerY) }, thickness: 1, color: gold });
  const note = `Prepared by ${branding.studioName}  ·  Confidential`;
  const noteW = regular.widthOfTextAtSize(note, 9);
  page.drawText(note, { x: (pageW - noteW) / 2, y: top(footerY + 16), size: 9, font: regular, color: footer });

  const bytes = await doc.save();
  downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), fileName);
};
