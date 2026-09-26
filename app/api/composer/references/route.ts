import { requireUser } from "@/lib/auth";
import { listConversationSkills } from "@/lib/bot-workspace-skills";
import { getBotByConversationId, listBots } from "@/lib/bots";
import { getConversation } from "@/lib/conversations";
import { notFoundResponse, ok } from "@/lib/http";
import type { ComposerReferences } from "@/lib/reference-tokens";
import { getSettingsForUser } from "@/lib/settings";
import { getSkillResolvedDescription, getSkillResolvedName } from "@/lib/skill-runtime";

export async function GET(request: Request) {
  const user = await requireUser();
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (conversationId && !getConversation(conversationId, user.id)) {
    return notFoundResponse("Conversation not found");
  }

  const bot = conversationId ? getBotByConversationId(conversationId) : null;
  const skills = getSettingsForUser(user.id).skillsEnabled ? listConversationSkills(bot) : [];
  const references: ComposerReferences = {
    bots: bot
      ? listBots(user.id)
          .filter((entry) => entry.id !== bot.id)
          .map((entry) => ({ name: entry.name, title: entry.title, avatarSeed: entry.avatarSeed }))
      : [],
    skills: skills.map((skill) => ({
      name: getSkillResolvedName(skill),
      description: getSkillResolvedDescription(skill)
    }))
  };

  return ok(references);
}
