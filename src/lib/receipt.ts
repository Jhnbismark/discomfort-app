import type { SessionResult } from '../screens/Session';
import { formatClock } from '../screens/Session';

/** RECEIPT — a shareable proof-of-result image, drawn on canvas in brand
 *  style. 1080×1350 (4:5) so it posts clean anywhere. Voided attempts get
 *  the VOID stamp instead of a number — the receipt never lies. */

const W = 1080;
const H = 1350;
const VOID_BG = '#0a0a0a';
const BONE = '#ededea';
const EARN = '#9be564';
const FAULT = '#e5484d';
const MONO = "'JetBrains Mono', 'Consolas', 'Menlo', monospace";

function mono(size: number, weight = 400): string {
  return `${weight} ${size}px ${MONO}`;
}

export function drawReceipt(
  result: SessionResult,
  handle: string | null
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = VOID_BG;
  ctx.fillRect(0, 0, W, H);

  // frame
  ctx.strokeStyle = 'rgba(237,237,234,0.25)';
  ctx.lineWidth = 3;
  ctx.strokeRect(50, 50, W - 100, H - 100);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // header
  ctx.fillStyle = BONE;
  ctx.font = mono(64, 700);
  ctx.fillText('DISCOMFORT', 100, 170);
  ctx.fillStyle = 'rgba(237,237,234,0.4)';
  ctx.font = mono(26);
  ctx.fillText('RECEIPT OF VERIFIED EFFORT', 100, 220);

  // date, right-aligned
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  ctx.textAlign = 'right';
  ctx.fillText(stamp, W - 100, 170);
  ctx.textAlign = 'left';

  // divider
  ctx.fillStyle = 'rgba(237,237,234,0.15)';
  ctx.fillRect(100, 270, W - 200, 3);

  // test
  ctx.fillStyle = 'rgba(237,237,234,0.6)';
  ctx.font = mono(40);
  ctx.fillText(result.title, 100, 380);

  if (result.voided) {
    // VOID stamp
    ctx.save();
    ctx.translate(W / 2, H / 2 + 40);
    ctx.rotate(-0.12);
    ctx.textAlign = 'center';
    ctx.fillStyle = FAULT;
    ctx.font = mono(260, 700);
    ctx.fillText('VOID', 0, 60);
    ctx.strokeStyle = FAULT;
    ctx.lineWidth = 8;
    ctx.strokeRect(-420, -160, 840, 340);
    ctx.restore();
    ctx.fillStyle = 'rgba(237,237,234,0.5)';
    ctx.font = mono(30);
    ctx.textAlign = 'center';
    ctx.fillText('NOTHING WAS VERIFIED. NOTHING COUNTS.', W / 2, H / 2 + 320);
    ctx.textAlign = 'left';
  } else {
    // the number
    const value =
      result.metric === 'clock'
        ? formatClock(result.value)
        : String(result.value);
    ctx.fillStyle = EARN;
    ctx.font = mono(value.length > 5 ? 220 : 300, 700);
    ctx.textAlign = 'center';
    ctx.fillText(value, W / 2, H / 2 + 90);

    ctx.fillStyle = 'rgba(237,237,234,0.7)';
    ctx.font = mono(36);
    const label =
      result.metric === 'rt'
        ? 'MS MEDIAN · LOWER WINS'
        : result.metric === 'clock'
          ? 'VERIFIED HOLD'
          : 'VERIFIED';
    ctx.fillText(label, W / 2, H / 2 + 180);
    ctx.textAlign = 'left';

    // secondary stats
    ctx.fillStyle = 'rgba(237,237,234,0.5)';
    ctx.font = mono(30);
    const stats: string[] = [];
    if (result.metric === 'rt') {
      stats.push(`LAPSES ${result.lapses ?? 0}`);
      stats.push(`FALSE STARTS ${result.falseStarts ?? 0}`);
    } else if (result.exerciseId !== 'stare') {
      stats.push(`FORM ${result.avgForm}`);
    }
    ctx.textAlign = 'center';
    ctx.fillText(stats.join('   ·   '), W / 2, H / 2 + 330);
    ctx.textAlign = 'left';
  }

  // identity
  ctx.fillStyle = handle ? EARN : 'rgba(237,237,234,0.35)';
  ctx.font = mono(44, 700);
  ctx.fillText(handle ?? 'UNIDENTIFIED', 100, H - 220);

  // footer
  ctx.fillStyle = 'rgba(237,237,234,0.35)';
  ctx.font = mono(24);
  ctx.fillText("A REP THAT ISN'T SEEN DOESN'T EXIST.", 100, H - 150);
  ctx.fillText('PROCESSED ON DEVICE. NOTHING WATCHES YOU BUT YOU.', 100, H - 110);

  return canvas;
}

/** Render + share the receipt (native share sheet where available, download
 *  fallback elsewhere). */
export async function shareReceipt(
  result: SessionResult,
  handle: string | null
): Promise<void> {
  const canvas = drawReceipt(result, handle);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!blob) throw new Error('RENDER FAILED');

  const name = `discomfort-${result.exerciseId}-${Date.now()}.png`;
  const file = new File([blob], name, { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'DISCOMFORT' });
      return;
    } catch (e) {
      // user cancelled the share sheet — not an error, and don't download
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
