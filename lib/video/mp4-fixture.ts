// Synthetic MP4 header builders, used only by tests (probe unit tests and the
// lecture upload integration test). Not imported by app code.

export const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
export const u32 = (n: number) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
export const u16 = (n: number) => Uint8Array.of((n >>> 8) & 255, n & 255);
export const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
export const box = (type: string, ...body: Uint8Array[]) => {
  const b = cat(...body);
  return cat(u32(8 + b.length), enc(type), b);
};
export const zeros = (n: number) => new Uint8Array(n);

export const ftyp = box("ftyp", enc("isom"), u32(512), enc("isom"));
export const mvhd = (timescale: number, duration: number) =>
  box("mvhd", zeros(4), zeros(8), u32(timescale), u32(duration), zeros(80));
export const videoTrak = (codec: string, w: number, h: number) =>
  box(
    "trak",
    box(
      "mdia",
      box("hdlr", zeros(4), zeros(4), enc("vide"), zeros(12)),
      box(
        "minf",
        box(
          "stbl",
          box("stsd", zeros(4), u32(1), box(codec, zeros(6), u16(1), zeros(16), u16(w), u16(h), zeros(50))),
        ),
      ),
    ),
  );
export const moov = (codec = "avc1", w = 1280, h = 720, dur = 600) =>
  box("moov", mvhd(1000, dur * 1000), videoTrak(codec, w, h));


/** A valid fast-start MP4 head: H.264, given size and duration. */
export function buildMp4Head(opts: { codec?: string; width?: number; height?: number; seconds?: number } = {}) {
  return cat(ftyp, moov(opts.codec, opts.width, opts.height, opts.seconds), box("mdat", zeros(64)));
}
