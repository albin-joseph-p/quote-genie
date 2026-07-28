import type { Annotation } from "@/components/annotation-editor";

export const fileToBase64 = async (file: File | Blob) => {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

/**
 * Physically blacks out "Exclude" annotation regions so the AI can never read
 * them. PDFs (and any non-image) are returned untouched.
 */
export const maskExcludedRegions = async (
  file: File,
  annotations: Annotation[],
): Promise<{ blob: Blob; base64: string; mimeType: string }> => {
  const mime =
    file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  const excludes = annotations.filter((a) => a.label === "Exclude");
  if (!mime.startsWith("image/") || excludes.length === 0) {
    return { blob: file, base64: await fileToBase64(file), mimeType: mime };
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, base64: await fileToBase64(file), mimeType: mime };
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = "#000000";
    for (const a of excludes) {
      ctx.fillRect(
        Math.round(a.x * canvas.width),
        Math.round(a.y * canvas.height),
        Math.round(a.w * canvas.width),
        Math.round(a.h * canvas.height),
      );
    }
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas encode failed"))), "image/jpeg", 0.92),
    );
    return { blob, base64: await fileToBase64(blob), mimeType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Strips client-only ids and Exclude boxes (already burned into pixels). */
export const annotationsForAi = (annotations: Annotation[]) =>
  annotations
    .filter((a) => a.label !== "Exclude")
    .map(({ id: _id, ...rest }) => rest);
