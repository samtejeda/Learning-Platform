"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { BLANK_CHIP_CLASS } from "./blank-style";
import { blankCount, canInsertBlank, insertBlank, removeBlank, stripToken } from "./prompt-blanks";

/**
 * Fill-in-the-blank prompt: text boxes with a fixed-size blank between them.
 * "Insert blank" splits the box you were typing in at the cursor. The
 * professor never sees or types any markup; a blank is removed with its own
 * button and the text around it joins back together.
 */
export function BlankPromptEditor({
  idPrefix,
  languageName,
  segments,
  onChange,
  structureLocked,
  lockedReason,
  error,
}: {
  idPrefix: string;
  languageName: string;
  segments: string[];
  onChange: (next: string[]) => void;
  /** Students have started: the number of blanks can't change. */
  structureLocked?: boolean;
  lockedReason?: string;
  error?: string;
}) {
  const caret = useRef({ index: 0, cursor: 0 });
  const focusNext = useRef<number | null>(null);
  const n = blankCount(segments);

  useEffect(() => {
    if (focusNext.current !== null) {
      const el = document.getElementById(`${idPrefix}-seg-${focusNext.current}`) as HTMLTextAreaElement | null;
      el?.focus();
      el?.setSelectionRange(0, 0);
      focusNext.current = null;
    }
  });

  const remember = (index: number, el: HTMLTextAreaElement) => {
    caret.current = { index, cursor: el.selectionStart ?? el.value.length };
  };

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink">Question text</p>
      <div className="space-y-2">
        {segments.map((text, i) => (
          <div key={i} className="space-y-2">
            <Textarea
              id={`${idPrefix}-seg-${i}`}
              rows={2}
              maxLength={2000}
              value={text}
              aria-label={`${languageName} question text, part ${i + 1} of ${segments.length}`}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                remember(i, e.target);
                onChange(segments.map((s, k) => (k === i ? stripToken(e.target.value) : s)));
              }}
              onSelect={(e) => remember(i, e.currentTarget)}
              onClick={(e) => remember(i, e.currentTarget)}
              onKeyUp={(e) => remember(i, e.currentTarget)}
              onFocus={(e) => remember(i, e.currentTarget)}
            />
            {i < segments.length - 1 && (
              <div className="flex items-center gap-2">
                <span className={BLANK_CHIP_CLASS}>Blank {i + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  disabled={structureLocked}
                  aria-label={`Remove blank ${i + 1} (${languageName})`}
                  onClick={() => onChange(removeBlank(segments, i))}
                >
                  Remove blank
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={structureLocked || !canInsertBlank(segments)}
          onClick={() => {
            const r = insertBlank(segments, caret.current.index, caret.current.cursor);
            focusNext.current = r.focusSegment;
            onChange(r.segments);
          }}
        >
          Insert blank
        </Button>
        <span className="text-sm tabular-nums text-muted" aria-live="polite">
          {n} {n === 1 ? "blank" : "blanks"}
        </span>
      </div>
      {structureLocked && lockedReason && <p className="mt-2 text-sm text-muted">{lockedReason}</p>}
      {!structureLocked && <p className="mt-2 text-xs text-muted">Click in the text where the blank should go, then press Insert blank.</p>}
      {error && <p className="mt-1.5 text-xs text-error">{error}</p>}
    </div>
  );
}
