import { buildBotAvatarSvg } from "@/lib/bot-avatar";

export function BotAvatar({
  seed,
  size = 36,
  className = "",
  inline = false
}: {
  seed: string;
  size?: number;
  className?: string;
  inline?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      data-inline-avatar={inline ? "true" : undefined}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${
        inline
          ? "translate-y-px rounded-[4px]"
          : "rounded-xl border border-white/8 bg-white/[0.03] text-white/70"
      } ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: buildBotAvatarSvg(seed, size) }}
    />
  );
}
