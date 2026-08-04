import type { NexusGoal, NexusStrategyFocus, NexusStrategySelection } from "./contracts";

export const NEXUS_STRATEGY_CATALOG: ReadonlyArray<{
  id: string; displayName: string; focus: NexusStrategyFocus; description: string; goals: NexusGoal[];
}> = [
  { id: "strategy_persuasion", displayName: "Persuasion", focus: "persuasion", description: "Ethical persuasive structure and reader motivation.", goals: ["persuade"] },
  { id: "strategy_brand_positioning", displayName: "Brand Positioning", focus: "brand_positioning", description: "Distinctive positioning and category leadership.", goals: ["build_authority", "challenge_assumptions"] },
  { id: "strategy_audience_building", displayName: "Audience Building", focus: "audience_building", description: "Useful, relevant content that earns attention.", goals: ["educate", "answer_reader_question", "explore_theme"] },
  { id: "strategy_intrigue", displayName: "Intrigue", focus: "intrigue", description: "Curiosity, atmosphere, and public-safe anticipation.", goals: ["create_intrigue", "build_anticipation", "deepen_character", "explore_theme", "reveal_story_world", "journal_style_entry"] },
  { id: "strategy_conversion_copy", displayName: "Conversion Copy", focus: "conversion_copy", description: "Clear action-oriented messaging without misleading urgency.", goals: ["drive_action"] },
  { id: "strategy_trust_authority", displayName: "Trust & Authority", focus: "trust_authority", description: "Credibility, clarity, and durable audience trust.", goals: ["build_audience_trust", "build_authority"] },
];

export function selectNexusStrategy(input: {
  goal: NexusGoal;
  mode?: "automatic" | "manual";
  primaryId?: string | null;
  supportingId?: string | null;
}): NexusStrategySelection {
  if (input.mode === "manual") {
    const primary = NEXUS_STRATEGY_CATALOG.find((guide) => guide.id === input.primaryId);
    const supporting = input.supportingId
      ? NEXUS_STRATEGY_CATALOG.find((guide) => guide.id === input.supportingId)
      : null;
    if (!primary) throw new Error("NEXUS_PRIMARY_STRATEGY_INVALID");
    if (input.supportingId && !supporting) throw new Error("NEXUS_SUPPORTING_STRATEGY_INVALID");
    if (supporting?.id === primary.id) throw new Error("NEXUS_STRATEGY_DUPLICATE");
    return { selectionMode: "manual", primaryStrategyGuideId: primary.id, supportingStrategyGuideId: supporting?.id || null, selectionReason: "Author selected active strategy guidance.", selectorVersion: 1 };
  }

  const primary = NEXUS_STRATEGY_CATALOG.find((guide) => guide.goals.includes(input.goal)) || NEXUS_STRATEGY_CATALOG[2];
  return { selectionMode: "automatic", primaryStrategyGuideId: primary.id, supportingStrategyGuideId: null, selectionReason: `Mapped ${input.goal} to ${primary.displayName}.`, selectorVersion: 1 };
}
