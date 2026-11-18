"use client";

import { useCallback, useEffect, useState } from "react";

// Contract: GET /api/lectures/[id]/stream   (API.md)
//   200 → { source: "upload", url, expiresAt (ISO) }   15-minute signed URL, Cache-Control: no-store
//       | { source: "youtube", videoId }               11-character id, nothing to refresh
//   404 (not enrolled / unpublished / unknown), 429, 503 storage_unavailable
//
// The caller (LecturePlayer) picks the player from `source`. The refresh rules
// below only matter for uploads.
//
// The URL is fetched once and re-fetched only on demand (`refresh()`): when
// playback starts and the URL is about to expire, or when the <video> errors
// (an expired URL fails the next range request). It is deliberately NOT
// swapped on a timer — changing <video src> mid-lecture would restart the
// video at 0:00.

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

type UploadState =
  | { status: "loading"; url: null }
  | { status: "ready"; source: "upload"; url: string; expiresAt: number }
  | { status: "error"; url: null; message: string };

type State = UploadState | { status: "ready"; source: "youtube"; videoId: string; url: null };

/** What the uploaded-video player works with: never the YouTube variant. */
export type UploadStream = UploadState & { refresh: () => void };
export type LectureStream = State & { refresh: () => void };

const MESSAGES: Record<number, string> = {
  401: "Your session has expired. Please sign in again to keep watching.",
  404: "This video isn't available.",
  429: "Too many requests. Please wait a moment and try again.",
  503: "Video is unavailable right now. Please try again.",
};

export function useStreamUrl(lectureId: string): LectureStream {
  const [state, setState] = useState<State>({ status: "loading", url: null });
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/lectures/${encodeURIComponent(lectureId)}/stream`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({
            status: "error",
            url: null,
            message: MESSAGES[res.status] ?? "We couldn't load this video.",
          });
          return;
        }
        const data = (await res.json()) as { source?: string; url?: string; expiresAt?: string; videoId?: string };
        if (cancelled) return;
        if (data.source === "youtube") {
          if (typeof data.videoId !== "string" || !YOUTUBE_ID.test(data.videoId)) {
            setState({ status: "error", url: null, message: "We couldn't load this video." });
            return;
          }
          setState({ status: "ready", source: "youtube", videoId: data.videoId, url: null });
          return;
        }
        if (typeof data.url !== "string" || typeof data.expiresAt !== "string") {
          setState({ status: "error", url: null, message: "We couldn't load this video." });
          return;
        }
        setState({ status: "ready", source: "upload", url: data.url, expiresAt: Date.parse(data.expiresAt) });
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          status: "error",
          url: null,
          message: "We couldn't load this video. Check your connection.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [lectureId, version]);

  return { ...state, refresh };
}
