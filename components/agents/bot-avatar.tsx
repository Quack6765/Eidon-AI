import { useBotAvatarMarkup } from "@/hooks/use-bot-avatar-markup";
import { buildBotAvatarUrl } from "@/lib/bot-avatar";
import type { BotStatus } from "@/lib/types";

export function BotAvatar({
  seed,
  size = 36,
  className = "",
  inline = false,
  status
}: {
  seed: string;
  size?: number;
  className?: string;
  inline?: boolean;
  status?: BotStatus;
}) {
  const markup = useBotAvatarMarkup(status === undefined ? null : seed);
  const animated = status !== undefined && markup !== null;
  const running = status === "running";

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
      {animated ? (
        <span
          className="bot-avatar h-full w-full"
          data-anim={running ? "on" : "off"}
          dangerouslySetInnerHTML={{ __html: markup ?? "" }}
        />
      ) : (
        <img
          src={buildBotAvatarUrl(seed)}
          alt=""
          width={size}
          height={size}
          className="h-full w-full"
        />
      )}
    </span>
  );
}
