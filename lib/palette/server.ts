import "server-only";

import { logger } from "@/lib/logger";
import { resolvePalette, type PaletteName } from "./index";

let warned = false;

/** The active palette for this deployment (reads `COLOR_PALETTE`). */
export function getActivePalette(): PaletteName {
  const { name, invalid } = resolvePalette(process.env.COLOR_PALETTE);
  if (invalid && !warned) {
    warned = true;
    logger.warn("palette.unknown_value", { value: invalid, using: name });
  }
  return name;
}
