// A lane = a run of consecutive screens that share an identical display
// condition. This is the unit the admin thinks of as a "track" ("all the A
// screens"), and it is also the unit of editing: one condition for the whole run.
//
// Without it, changing a track's condition is 19 identical edits, and forgetting
// any one of them splits the lane in two with no sign at all — in the diagram and
// in the actual flow alike.

import type { Screen } from '../engine/types';

/**
 * Every screen that shares `id`'s display condition in an unbroken run.
 * A screen with no display condition stands alone — it has no lane.
 */
export function laneMembers(screens: Screen[], id: string): string[] {
  const index = screens.findIndex((s) => s.id === id);
  if (index < 0) return [];
  const key = screens[index].showIf ? JSON.stringify(screens[index].showIf) : null;
  if (key === null) return [id];

  let start = index;
  while (start > 0 && screens[start - 1].showIf && JSON.stringify(screens[start - 1].showIf) === key) {
    start--;
  }
  let end = index;
  while (
    end + 1 < screens.length &&
    screens[end + 1].showIf &&
    JSON.stringify(screens[end + 1].showIf) === key
  ) {
    end++;
  }
  return screens.slice(start, end + 1).map((s) => s.id);
}
