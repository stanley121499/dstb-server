-- Phase 5: at most one active behavior ruleset (matches BehaviorSupabaseSync.fetchActiveRuleset)

CREATE UNIQUE INDEX behavior_rulesets_single_active ON behavior_rulesets (is_active)
  WHERE (is_active = true);
