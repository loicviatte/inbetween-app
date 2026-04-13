// Module-level singleton — tracks class_input_ids the user has already responded to
// in the current app session, as a fallback before DB reflects the edge function result.
export const locallyRespondedAttendance = new Set();

// Module-level singleton — tracks notification IDs for name_match_confirm already resolved by coach.
export const locallyResolvedNameMatches = new Set();
