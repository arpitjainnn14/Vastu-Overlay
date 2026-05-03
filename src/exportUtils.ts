import { jsPDF } from "jspdf";

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export const exportCanvasAsJpeg = async (
  canvas: HTMLCanvasElement,
  fileName: string,
) => {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.95),
  );

  if (!blob) {
    throw new Error("Unable to generate JPEG export.");
  }

  downloadBlob(blob, fileName);
};

export const exportCanvasAsPdf = async (
  canvas: HTMLCanvasElement,
  fileName: string,
) => {
  const imageData = canvas.toDataURL("image/jpeg", 0.98);
  const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
  const pdf = new jsPDF({
    orientation,
    unit: "px",
    format: [canvas.width, canvas.height],
  });

  pdf.addImage(imageData, "JPEG", 0, 0, canvas.width, canvas.height);
  pdf.save(fileName);
};
