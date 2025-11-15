import { getToken } from "../../../lib/storage";

/**
 * Load a waveform image with authentication support
 * Handles local /media URLs with auth headers and presigned URLs
 */
export async function loadWaveformImage(
  url: string,
): Promise<HTMLImageElement> {
  // Only add auth headers for local /media URLs
  // Presigned R2 URLs have auth in the URL itself
  const isLocalMedia = url.startsWith("/media");
  const headers: HeadersInit = {};

  if (isLocalMedia) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(url, {
    headers,
    cache: "default", // Allow browser caching
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch waveform: ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load waveform image"));
    };
    img.src = objectUrl;
  });
}
