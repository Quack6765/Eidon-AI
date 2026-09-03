import { buildBotAvatarUrl } from "@/lib/bot-avatar";

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
          : "rounded-xl border border-white/8 bg-white/[0.03]"
      } ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={buildBotAvatarUrl(seed)}
        alt=""
        width={size}
        height={size}
        className={`h-full w-full ${size <= 28 ? "scale-[1.2]" : ""}`}
      />
    </span>
  );
}
