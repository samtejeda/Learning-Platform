import { z } from "zod";

const seconds = z.number().finite().min(0).max(24 * 60 * 60);

/** Body of POST /api/lectures/[id]/progress. */
export const progressSegmentSchema = z
  .object({
    from: seconds,
    to: seconds,
    /** Where the playhead is now, for resume. */
    position: seconds.optional(),
  })
  .strict();

export type ProgressSegmentInput = z.output<typeof progressSegmentSchema>;

/** Shape of the stored `watched_intervals` jsonb; anything else is discarded. */
export const storedIntervalsSchema = z.array(z.tuple([z.number(), z.number()])).catch([]);
