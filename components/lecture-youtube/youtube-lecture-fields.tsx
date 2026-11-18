"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { parseYoutubeLink } from "@/lib/video/youtube";
import { combineDuration, durationFieldMessage, splitDuration } from "@/lib/video/duration-fields";
import { formatTime } from "@/lib/video/format-time";
import { Button } from "@/components/ui/button";
import { Field, FieldShell, controlAria } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { YoutubeEmbed, type YoutubeEmbedHandlers } from "@/components/video-player/youtube-embed";
import type { YtPlayer } from "@/components/video-player/youtube-types";

const LINK_ERROR =
  "That isn't a YouTube video link. Paste a youtube.com/watch, youtu.be, shorts or embed link for a single video.";

/** getDuration() is sometimes 0 until metadata loads, so look a few times before giving up. */
const READ_TRIES = 12;
const READ_EVERY_MS = 500;

type Props = {
  /** The video already saved (edit page); shown as the preview while the link box is blank. */
  initialVideoId?: string | null;
  /** The length already saved, in seconds. */
  initialSeconds?: number | null;
  /** Server errors, shown as written. */
  errors?: { youtubeUrl?: string[]; durationSeconds?: string[] };
  /** Edit: a blank link keeps the current video. */
  linkOptional?: boolean;
  disabled?: boolean;
};

/**
 * The YouTube-specific part of the lecture form: the link, a preview of the
 * video, and the length. The length is read from the YouTube player in this
 * browser (the professor's) and filled in; the minutes/seconds boxes are always
 * editable and what is typed wins. Submits `youtubeUrl` and `durationSeconds`
 * with the surrounding form; the server re-validates both and never fetches the
 * link.
 */
export function YoutubeLectureFields({ initialVideoId = null, initialSeconds = null, errors, linkOptional, disabled }: Props) {
  const id = useId();
  const [link, setLink] = useState("");
  const initial = splitDuration(initialSeconds);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [seconds, setSeconds] = useState(initial.seconds);
  const [read, setRead] = useState<{ videoId: string; seconds: number } | null>(null);
  const [gaveUp, setGaveUp] = useState<string | null>(null);
  const touched = useRef(false);

  const trimmed = link.trim();
  const parsed = useMemo(() => (trimmed ? parseYoutubeLink(trimmed) : null), [trimmed]);
  const previewId = parsed ? (parsed.ok ? parsed.videoId : null) : initialVideoId;
  const linkProblem = parsed && !parsed.ok ? LINK_ERROR : null;

  const total = combineDuration(minutes, seconds);
  const readHere = read && read.videoId === previewId ? read.seconds : null;
  const waiting = previewId !== null && readHere === null && gaveUp !== previewId;

  // Reading the length: poll the player a few times; stop at the first real value.
  const readTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (readTimer.current) clearInterval(readTimer.current);
    },
    [],
  );

  const handlers = useMemo<YoutubeEmbedHandlers>(() => {
    const apply = (videoId: string, value: number) => {
      setRead({ videoId, seconds: value });
      // Fill the boxes unless the professor has typed their own, or this is the
      // video already saved (then it is offered below instead of replacing it).
      if (!touched.current && (initialSeconds === null || videoId !== initialVideoId)) {
        const parts = splitDuration(value);
        setMinutes(parts.minutes);
        setSeconds(parts.seconds);
      }
    };
    return {
      onReady: (player: YtPlayer) => {
        if (readTimer.current) clearInterval(readTimer.current);
        const videoId = previewId;
        if (!videoId) return;
        let tries = 0;
        const attempt = () => {
          const d = player.getDuration();
          if (Number.isFinite(d) && d > 0) {
            if (readTimer.current) clearInterval(readTimer.current);
            apply(videoId, Math.round(d));
            return true;
          }
          return false;
        };
        if (attempt()) return;
        readTimer.current = setInterval(() => {
          tries += 1;
          if (attempt()) return;
          if (tries >= READ_TRIES) {
            if (readTimer.current) clearInterval(readTimer.current);
            setGaveUp(videoId);
          }
        }, READ_EVERY_MS);
      },
    };
  }, [previewId, initialSeconds, initialVideoId]);

  const linkErrors = linkProblem ? [linkProblem] : errors?.youtubeUrl;
  const clientDurationMessage = durationFieldMessage(minutes, seconds);
  const durationErrors = clientDurationMessage ? [clientDurationMessage] : errors?.durationSeconds;
  const minutesId = `${id}-minutes`;
  const secondsId = `${id}-seconds`;
  const durationHintId = `${id}-duration-hint`;

  return (
    <div className="space-y-5">
      <Field
        label="YouTube link"
        name="youtubeUrl"
        type="url"
        inputMode="url"
        autoComplete="off"
        required={!linkOptional}
        optional={linkOptional}
        maxLength={300}
        placeholder="https://www.youtube.com/watch?v=…"
        hint={
          linkOptional
            ? "Leave blank to keep the current video. Paste a new link to change it."
            : "Paste the link to a single video: youtube.com/watch, youtu.be, shorts or embed."
        }
        value={link}
        onChange={(e) => setLink(e.target.value)}
        errors={linkErrors}
        disabled={disabled}
      />

      {previewId && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">{parsed ? "Preview" : "Current video"}</p>
          <YoutubeEmbed key={previewId} videoId={previewId} handlers={handlers} label="YouTube preview" />
        </div>
      )}

      <input type="hidden" name="durationSeconds" value={total ?? ""} />
      <fieldset className="min-w-0 space-y-2" aria-describedby={durationHintId} disabled={disabled}>
        <legend className="mb-1.5 text-sm font-medium text-ink">Length</legend>
        <div className="grid grid-cols-2 gap-3">
          <FieldShell label="Minutes" id={minutesId}>
            <Input
              {...controlAria(minutesId, durationErrors)}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder="45"
              className="min-h-11"
              value={minutes}
              onChange={(e) => {
                touched.current = true;
                setMinutes(e.target.value);
              }}
            />
          </FieldShell>
          <FieldShell label="Seconds" id={secondsId}>
            <Input
              {...controlAria(secondsId, durationErrors)}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder="0"
              className="min-h-11"
              value={seconds}
              onChange={(e) => {
                touched.current = true;
                setSeconds(e.target.value);
              }}
            />
          </FieldShell>
        </div>

        {durationErrors?.length ? (
          <p className="text-xs text-error" role="alert">
            {durationErrors[0]}
          </p>
        ) : total !== null ? (
          <p className="text-sm text-body-strong">This lecture will be saved as {formatTime(total)} long.</p>
        ) : null}

        <div aria-live="polite" className="text-sm text-muted">
          {previewId && waiting && <p>Reading the length from YouTube…</p>}
          {readHere !== null && (
            <p className="flex flex-wrap items-center gap-x-2">
              <span>YouTube reports a length of {formatTime(readHere)}.</span>
              {total !== readHere && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-11"
                  onClick={() => {
                    const parts = splitDuration(readHere);
                    touched.current = true;
                    setMinutes(parts.minutes);
                    setSeconds(parts.seconds);
                  }}
                >
                  Use {formatTime(readHere)}
                </Button>
              )}
            </p>
          )}
          {previewId && !waiting && readHere === null && (
            <p>YouTube didn&apos;t report a length for this video (live streams and some videos don&apos;t). Enter it in the boxes above.</p>
          )}
        </div>

        <p id={durationHintId} className="text-xs text-muted">
          Check this against the video. A length that is too long makes the lecture hard to complete, and one that is too short makes it too
          easy, because completion is 95% of this length.
        </p>
      </fieldset>
    </div>
  );
}
