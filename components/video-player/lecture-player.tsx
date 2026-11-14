"use client";

import type { ProgressView } from "@/lib/data/progress";
import { useStreamUrl } from "./use-stream-url";
import { VideoPlayer } from "./video-player";
import { YoutubePlayer } from "./youtube-player";

type Props = {
  lectureId: string;
  title: string;
  /** The server's duration (the denominator for completion); null if unknown. */
  durationSeconds: number | null;
  /** False for an instructor preview: no progress is recorded. */
  tracksProgress: boolean;
  initialProgress: ProgressView;
  next?: { href: string; title: string } | null;
};

/**
 * Picks the player from what the stream route says the lecture's video is:
 * an uploaded file (our custom player) or an embedded YouTube video (YouTube's
 * own player). The lecture page doesn't know the source, and a YouTube id is
 * only ever fetched here, from the access-checked stream route.
 */
export function LecturePlayer(props: Props) {
  const stream = useStreamUrl(props.lectureId);

  if (stream.status === "ready" && stream.source === "youtube") {
    return (
      <YoutubePlayer
        lectureId={props.lectureId}
        title={props.title}
        videoId={stream.videoId}
        durationSeconds={props.durationSeconds}
        tracksProgress={props.tracksProgress}
        initialProgress={props.initialProgress}
        next={props.next}
      />
    );
  }
  return <VideoPlayer {...props} stream={stream} />;
}
