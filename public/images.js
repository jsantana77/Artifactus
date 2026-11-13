/* Image and video helpers for maps: shrink a big image to something that uploads quickly, make a small preview,
   and check a video loop. */

export const MAP_ACCEPT = "image/*,video/mp4,video/webm";
export const VIDEO_MAX = 4 * 1024 * 1024;   // the hosting platform only lets a request carry about 6 MB once encoded

/* Map pictures keep as many pixels as fit in the same upload limit, so there's more to see when you zoom in. */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const MAP_MAX_SIDE = 4096;     // pixels along the longest side
export const MAP_MAX_PIXELS = 14e6;   // phones can't draw a much bigger picture than this in one go

const videoType = (f) => (f.type && f.type.startsWith("video/") ? f.type.split(";")[0]
  : /\.webm$/i.test(f.name || "") ? "video/webm" : /\.(mp4|m4v)$/i.test(f.name || "") ? "video/mp4" : "");
export const isVideoFile = (f) => !!videoType(f);

/* Load a video far enough to read its size and its first picture. */
function openVideo(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto";
    const fail = () => { URL.revokeObjectURL(url); reject(new Error("This browser can't play that video. Try an MP4 (H.264) or a WebM file.")); };
    const timer = setTimeout(fail, 12000);
    v.addEventListener("loadeddata", () => { clearTimeout(timer); resolve({ video: v, url }); }, { once: true });
    v.addEventListener("error", () => { clearTimeout(timer); fail(); }, { once: true });
    v.src = url;
  });
}

function frameToJpeg(source, width) {
  const sw = source.videoWidth || source.width, sh = source.videoHeight || source.height;
  const k = Math.min(1, width / sw);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.72));
}

/* Does this browser really save WebP? (Some, like Safari, quietly hand back a PNG instead.) WebP files are about a quarter
   smaller than JPEG at the same look, which means more pixels in the same upload. */
let webpTest = null;
const webpWorks = () => (webpTest ||= new Promise((resolve) => {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 2;
    c.toBlob((b) => resolve(!!b && b.type === "image/webp"), "image/webp", 0.8);
  } catch { resolve(false); }
}));

export async function compressMap(file) {
  const vt = videoType(file);
  if (vt) {
    if (file.size > VIDEO_MAX) {
      throw new Error(`That video is ${(file.size / 1048576).toFixed(1)} MB and the limit is 4 MB. Make the loop shorter, or export it smaller (for example 1280 pixels wide at a low bitrate), then try again.`);
    }
    const blob = new Blob([file], { type: vt });
    const { video, url } = await openVideo(blob);
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { URL.revokeObjectURL(url); throw new Error("That video has no picture I can read."); }
    const thumb = await frameToJpeg(video, 320);
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    return { blob, w, h, kind: "video", thumb };
  }
  const bmp = await createImageBitmap(file);
  const type = (await webpWorks()) ? "image/webp" : "image/jpeg";
  // Never enlarge, never go past the size a phone can draw, and keep it within the upload limit.
  let scale = Math.min(1, MAP_MAX_SIDE / Math.max(bmp.width, bmp.height), Math.sqrt(MAP_MAX_PIXELS / (bmp.width * bmp.height)));
  for (let i = 0; i < 9; i++) {
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    // Best quality first; only give up quality, then pixels, when the file is still too big.
    for (const q of i === 0 ? [0.9, 0.82, 0.74] : [0.85, 0.76]) {
      const blob = await new Promise((r) => c.toBlob(r, type, q));
      if (blob && blob.size <= IMAGE_MAX_BYTES) return { blob, w, h, kind: "image" };
    }
    scale *= 0.85;
  }
  throw new Error("That map is too large even after shrinking. Try a smaller image.");
}

export async function makeThumb(blob, width = 320) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, width / bmp.width);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.72));
}
