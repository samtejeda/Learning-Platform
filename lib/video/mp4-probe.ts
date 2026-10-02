// Pure MP4 header probe: no I/O, no Next imports. Given the first bytes of a
// file (and its total size) it reports duration, resolution, video codec and
// whether the `moov` box sits before `mdat` ("fast start", so playback and
// seeking work without downloading the whole file first).
//
// Input is professor-supplied bytes, so every read is bounds-checked and
// box walking is capped; malformed input returns { ok: false }, never throws.

export type Mp4Info = {
  durationSeconds: number;
  width: number;
  height: number;
  /** FourCC of the first video sample entry, e.g. "avc1", "hvc1". */
  videoCodec: string | null;
  /** True when `moov` precedes `mdat`. */
  fastStart: boolean;
  /** Average bits/second over the whole file (size * 8 / duration). */
  bitrateBps: number;
};

export type Mp4ProbeResult =
  | { ok: true; info: Mp4Info }
  | { ok: false; reason: "not_mp4" | "moov_not_in_head" | "malformed" };

type Box = { type: string; start: number; dataStart: number; end: number };

const MAX_BOXES = 256;

function fourcc(v: DataView, o: number): string {
  return String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
}

/** Reads one box header at `o`, clamped to `limit`. Null if it doesn't fit. */
function readBox(v: DataView, o: number, limit: number, fileEnd: number): Box | null {
  if (o + 8 > limit) return null;
  let size = v.getUint32(o);
  const type = fourcc(v, o + 4);
  let header = 8;
  if (size === 1) {
    if (o + 16 > limit) return null;
    const hi = v.getUint32(o + 8);
    const lo = v.getUint32(o + 12);
    size = hi * 2 ** 32 + lo;
    header = 16;
  } else if (size === 0) {
    size = fileEnd - o; // extends to end of file
  }
  if (size < header) return null;
  return { type, start: o, dataStart: o + header, end: o + size };
}

function children(v: DataView, parent: Box, limit: number): Box[] {
  const out: Box[] = [];
  let o = parent.dataStart;
  const end = Math.min(parent.end, limit);
  while (out.length < MAX_BOXES) {
    const b = readBox(v, o, end, end);
    if (!b) break;
    out.push(b);
    if (b.end <= o) break;
    o = b.end;
  }
  return out;
}

function find(list: Box[], type: string): Box | undefined {
  return list.find((b) => b.type === type);
}

export function probeMp4(head: Uint8Array, totalSize: number): Mp4ProbeResult {
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const limit = head.byteLength;

  const first = readBox(v, 0, limit, totalSize);
  if (!first || first.type !== "ftyp") return { ok: false, reason: "not_mp4" };

  // Walk top-level boxes inside the head looking for moov, noting mdat.
  let moov: Box | undefined;
  let sawMdatFirst = false;
  let o = 0;
  for (let i = 0; i < MAX_BOXES; i++) {
    const b = readBox(v, o, limit, totalSize);
    if (!b) break;
    if (b.type === "mdat" && !moov) sawMdatFirst = true;
    if (b.type === "moov") {
      moov = b;
      break;
    }
    if (b.end <= o) break;
    o = b.end;
  }
  if (!moov) return { ok: false, reason: "moov_not_in_head" };
  if (moov.end > limit) return { ok: false, reason: "moov_not_in_head" };

  const moovKids = children(v, moov, limit);
  const mvhd = find(moovKids, "mvhd");
  if (!mvhd) return { ok: false, reason: "malformed" };

  const version = v.getUint8(mvhd.dataStart);
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (mvhd.dataStart + 32 > limit) return { ok: false, reason: "malformed" };
    timescale = v.getUint32(mvhd.dataStart + 20);
    duration = v.getUint32(mvhd.dataStart + 24) * 2 ** 32 + v.getUint32(mvhd.dataStart + 28);
  } else {
    if (mvhd.dataStart + 20 > limit) return { ok: false, reason: "malformed" };
    timescale = v.getUint32(mvhd.dataStart + 12);
    duration = v.getUint32(mvhd.dataStart + 16);
  }
  if (timescale === 0 || duration === 0) return { ok: false, reason: "malformed" };
  const durationSeconds = duration / timescale;

  // First video track's sample description: codec + dimensions.
  let videoCodec: string | null = null;
  let width = 0;
  let height = 0;
  for (const trak of moovKids.filter((b) => b.type === "trak")) {
    const mdia = find(children(v, trak, limit), "mdia");
    if (!mdia) continue;
    const mdiaKids = children(v, mdia, limit);
    const hdlr = find(mdiaKids, "hdlr");
    if (!hdlr || hdlr.dataStart + 12 > limit || fourcc(v, hdlr.dataStart + 8) !== "vide") continue;
    const minf = find(mdiaKids, "minf");
    const stbl = minf && find(children(v, minf, limit), "stbl");
    const stsd = stbl && find(children(v, stbl, limit), "stsd");
    if (!stsd || stsd.dataStart + 8 > limit) continue;
    const entry = readBox(v, stsd.dataStart + 8, Math.min(stsd.end, limit), stsd.end);
    if (!entry || entry.dataStart + 28 > limit) continue;
    videoCodec = entry.type;
    width = v.getUint16(entry.dataStart + 24);
    height = v.getUint16(entry.dataStart + 26);
    break;
  }

  return {
    ok: true,
    info: {
      durationSeconds,
      width,
      height,
      videoCodec,
      fastStart: !sawMdatFirst,
      bitrateBps: (totalSize * 8) / durationSeconds,
    },
  };
}
