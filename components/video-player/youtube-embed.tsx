"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { YOUTUBE_EMBED_HOST, loadYoutubeApi } from "./youtube-api";
import { YOUTUBE_ERROR_HELP, YOUTUBE_LOAD_FAILED, youtubeErrorMessage } from "./youtube-messages";
import type { YtPlayer } from "./youtube-types";

export type YoutubeEmbedHandlers = {
  onReady?: (player: YtPlayer) => void;
  onStateChange?: (state: number, player: YtPlayer) => void;
  onRateChange?: (rate: number, player: YtPlayer) => void;
  /** YouTube reported an error code for this video. */
  onPlayerError?: (code: number) => void;
};

type Props = {
  videoId: string;
  /** Where to start, whole seconds (resume). */
  startSeconds?: number;
  handlers?: YoutubeEmbedHandlers;
  /** Edge to edge on a phone, like the uploaded-video player. */
  bleed?: boolean;
  /** Accessible name for the player region. */
  label: string;
  /** Show the "tell your professor" nudge with a player error (students). */
  studentHelp?: boolean;
};

/**
 * The official YouTube player in a 16:9 box (privacy-enhanced host, default
 * YouTube controls). YouTube's terms forbid covering or modifying the player,
 * so nothing is ever drawn over this box: the loading line disappears the
 * moment the player exists, and every problem message is rendered BELOW it.
 * If the API script can't load, no box is shown, only a message and "Try again".
 */
export function YoutubeEmbed({ videoId, startSeconds = 0, handlers, bleed, label, studentHelp }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handlersRef = useRef<YoutubeEmbedHandlers | undefined>(handlers);
  const startRef = useRef(startSeconds);
  const [phase, setPhase] = useState<"loading" | "created" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [playerError, setPlayerError] = useState<number | null>(null);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let player: YtPlayer | null = null;

    setPhase("loading");
    setPlayerError(null);

    loadYoutubeApi()
      .then((yt) => {
        if (cancelled) return;
        // YT.Player replaces its target element, so give it one React doesn't own.
        const target = document.createElement("div");
        host.appendChild(target);
        player = new yt.Player(target, {
          videoId,
          host: YOUTUBE_EMBED_HOST,
          playerVars: {
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
            start: Math.max(0, Math.floor(startRef.current)),
          },
          events: {
            onReady: (e) => handlersRef.current?.onReady?.(e.target),
            onStateChange: (e) => handlersRef.current?.onStateChange?.(e.data, e.target),
            onPlaybackRateChange: (e) => handlersRef.current?.onRateChange?.(e.data, e.target),
            onError: (e) => {
              setPlayerError(e.data);
              handlersRef.current?.onPlayerError?.(e.data);
            },
          },
        });
        setPhase("created");
      })
      .catch(() => {
        if (!cancelled) setPhase("failed");
      });

    return () => {
      cancelled = true;
      try {
        player?.destroy();
      } catch {
        // already gone
      }
      host.replaceChildren();
    };
  }, [videoId, attempt]);

  return (
    <div className="space-y-3">
      {phase === "failed" && (
        <div className="space-y-3">
          <Alert tone="error">{YOUTUBE_LOAD_FAILED}</Alert>
          <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}
      {/* Kept mounted (hidden while failed) so a retry has somewhere to put the player. */}
      <div
        role="region"
        aria-label={label}
        className={`relative aspect-video overflow-hidden bg-black ${phase === "failed" ? "hidden" : ""} ${
          bleed ? "-mx-4 sm:mx-0 sm:rounded-lg" : "rounded-lg"
        }`}
      >
        <div ref={hostRef} className="absolute inset-0 [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:size-full" />
        {/* Only until the player exists; it is removed before YouTube draws anything. */}
        {phase === "loading" && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-on-dark-soft" aria-live="polite">
            Loading video…
          </p>
        )}
      </div>
      {playerError !== null && phase !== "failed" && (
        <Alert tone="error">
          {youtubeErrorMessage(playerError)}
          {studentHelp ? ` ${YOUTUBE_ERROR_HELP}` : ""}
        </Alert>
      )}
    </div>
  );
}
