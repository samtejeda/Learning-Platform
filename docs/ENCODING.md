# Encoding lecture videos

Lecture uploads must be **MP4, H.264, at most 1280x720, averaging about 2 Mbps or less, with the index at the front of the file**. The upload is checked on the server after it lands; a file that fails is removed and the message says what to fix. Why: it keeps 36 courses of video small and keeps every view cheap (see `PROGRESS.md`, "Decisions & assumptions").

| Check | Limit | If exceeded |
|---|---|---|
| Container / codec | MP4 with H.264 (`avc1`) | Rejected. iPhone `.mov` files are often HEVC, and WebM is VP9/AV1. |
| Resolution | Up to 1280x720 (portrait 720x1280 is fine) | Rejected |
| Average bitrate | Target ~2 Mbps. Above 2.25 Mbps: accepted with a note. Above 3 Mbps: rejected | |
| Index at the front ("fast start") | Required | Rejected. Playback couldn't start until the whole file downloaded. |
| File size | 1 GiB | Rejected before upload starts |

## Recommended: ffmpeg

```
ffmpeg -i input.mov \
  -vf "scale=-2:'min(720,ih)'" \
  -c:v libx264 -preset slow -profile:v main -pix_fmt yuv420p \
  -b:v 1500k -maxrate 2000k -bufsize 4000k \
  -c:a aac -b:a 96k \
  -movflags +faststart \
  lecture.mp4
```

`-movflags +faststart` puts the index at the front; `min(720,ih)` never upscales a smaller source. Video at 1.5 Mbps plus audio at 96 kbps averages about 1.6 Mbps, so a 45-minute lecture is roughly 540 MB. **(untested)** against a real recording; the first batch should be run and uploaded by Sam before professors are pointed at this.

## HandBrake (no command line)

1. Preset: **Fast 720p30**.
2. Format: **MP4**, and tick **Web Optimized** (this is "fast start").
3. Video tab: Encoder **H.264 (x264)**, Constant Quality **RF 24** (raise to 26 if the upload is rejected for bitrate).
4. Audio tab: AAC, 96-128 kbps.

## If an upload is rejected

Read the message; it names the problem. Re-export with the settings above and upload again (the lecture stays as "Upload pending").
