// Module-level singleton — Map<class_input_id, attended:boolean> for class_inputs
// the user has already responded to in the current app session, as a fallback
// before DB reflects the edge function result. `.has(id)` and `.get(id)` both used.
export const locallyRespondedAttendance = new Map();

// Module-level singleton — tracks notification IDs for name_match_confirm already resolved by coach.
export const locallyResolvedNameMatches = new Set();
