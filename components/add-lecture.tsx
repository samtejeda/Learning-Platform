"use client";

import { useState } from "react";
import { SegmentedRadio } from "@/components/ui/segmented-radio";
import { LectureUploadForm } from "./lecture-upload-form";
import { LectureYoutubeForm } from "./lecture-youtube/lecture-youtube-form";

type Source = "upload" | "youtube";

/**
 * "Add a lecture": first choose where the video comes from, then the matching
 * form. Nothing is chosen at first, so a professor always sees the choice. The
 * choice is per lecture (a course may mix both) and fixed once the lecture
 * exists.
 */
export function AddLecture({ courseId }: { courseId: string }) {
  const [source, setSource] = useState<Source | "">("");

  return (
    <div className="space-y-5">
      <SegmentedRadio<Source | "">
        legend="Where is the video?"
        name="lecture-source"
        value={source}
        onChange={setSource}
        tall
        options={[
          { value: "upload", label: "Upload a video" },
          { value: "youtube", label: "YouTube link" },
        ]}
      />
      {source === "upload" && <LectureUploadForm courseId={courseId} />}
      {source === "youtube" && <LectureYoutubeForm courseId={courseId} />}
    </div>
  );
}
