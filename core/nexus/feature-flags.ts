export interface NexusFeatureFlags {
  multiSite: boolean;
  storyWorld: boolean;
  referenceGuide: boolean;
  strategySelector: boolean;
  groundingValidation: boolean;
}

function enabled(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function getNexusFeatureFlags(): NexusFeatureFlags {
  return {
    multiSite: enabled("NEXUS_MULTI_SITE_ENABLED", false),
    storyWorld: enabled("NEXUS_STORY_WORLD_ENABLED", false),
    referenceGuide: enabled("NEXUS_REFERENCE_GUIDE_ENABLED", false),
    strategySelector: enabled("NEXUS_STRATEGY_SELECTOR_ENABLED", true),
    groundingValidation: enabled("NEXUS_GROUNDING_VALIDATION_ENABLED", false),
  };
}
