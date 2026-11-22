import type { FaceBox } from '@homecard/shared';
import { previewUrl } from './image';

/**
 * Local face detection for photos that do not come from Immich (uploads, /data/photos).
 * Uses the SSD MobileNet v1 model bundled in /vendor/face-api — no network access. The result
 * is stored server-side so detection only ever runs once per photo.
 */
let faceapiP: Promise<typeof import('@vladmandic/face-api')> | null = null;

async function faceapi() {
  if (!faceapiP) {
    faceapiP = import('@vladmandic/face-api').then(async (fa) => {
      const tf = fa.tf as unknown as { setBackend(b: string): Promise<boolean>; ready(): Promise<void> };
      try {
        if (!(await tf.setBackend('webgl'))) throw new Error('webgl unavailable');
      } catch {
        await tf.setBackend('cpu');
      }
      await tf.ready();
      await fa.nets.ssdMobilenetv1.loadFromUri('/vendor/face-api');
      return fa;
    });
    faceapiP.catch(() => (faceapiP = null));
  }
  return faceapiP;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

let queue: Promise<unknown> = Promise.resolve();

/** Detect faces in a photo's preview; boxes are normalized to the oriented image. */
export function detectFaces(ref: string): Promise<FaceBox[]> {
  const run = async () => {
    const fa = await faceapi();
    const img = await loadImage(previewUrl(ref));
    const dets = await fa.detectAllFaces(img, new fa.SsdMobilenetv1Options({ minConfidence: 0.45, maxResults: 30 }));
    const W = img.naturalWidth, H = img.naturalHeight;
    return dets
      .map((d) => ({ x: d.box.x / W, y: d.box.y / H, w: d.box.width / W, h: d.box.height / H, score: Math.round(d.score * 1000) / 1000 }))
      .filter((f) => f.w > 0.01 && f.h > 0.01);
  };
  // Serialize: the model is heavy and GPU-bound.
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}
