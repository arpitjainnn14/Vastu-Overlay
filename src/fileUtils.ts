import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { FloorPlanAsset, MappingTemplate, Point } from "./types";
import { DEFAULT_MAPPING_TEMPLATE } from "./defaultMapping";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const loadImage = async (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

const readAsDataUrl = async (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export const urlToFile = async (url: string, fileName: string, mimeType: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load ${fileName}.`);
  }

  const blob = await response.blob();
  return new File([blob], fileName, { type: mimeType });
};

const defaultCenterPoint = (width: number, height: number): Point => ({
  x: width / 2,
  y: height / 2,
});

const detectPlanCenter = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): Point => {
  const { data } = context.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const isForeground = alpha > 32 && (red < 245 || green < 245 || blue < 245);

      if (!isForeground) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return defaultCenterPoint(width, height);
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
};

export const fileToFloorPlan = async (file: File): Promise<FloorPlanAsset> => {
  if (file.type === "application/pdf") {
    const bytes = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas context is not available for PDF rendering.");
    }

    await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context, viewport }).promise;

    return {
      fileName: file.name,
      mimeType: "image/png",
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
      centerPoint: detectPlanCenter(context, canvas.width, canvas.height),
    };
  }

  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas context is not available for image processing.");
  }

  context.drawImage(image, 0, 0, image.width, image.height);

  return {
    fileName: file.name,
    mimeType: file.type,
    dataUrl,
    width: image.width,
    height: image.height,
    centerPoint: detectPlanCenter(context, image.width, image.height),
  };
};

export const fileToMappingTemplate = async (file: File): Promise<MappingTemplate> => {
  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);

  return {
    id: crypto.randomUUID(),
    name: file.name,
    imageDataUrl: dataUrl,
    labels: [],
    width: image.width,
    height: image.height,
    anchors: [
      { x: image.width / 2, y: image.height * 0.14 },
      { x: image.width / 2, y: image.height * 0.86 },
    ],
  };
};
