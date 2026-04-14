import type { ReactNode } from "react";
import { Badge } from "./badge";
import type { BadgeVariant } from "./badge";

export function ProfileCard({
  isActive,
  onClick,
  isDisabled = false,
  title,
  subtitle,
  badges,
  rightSlot,
}: {
  isActive: boolean;
  isDisabled?: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  badges?: Array<{ variant: BadgeVariant; label: string }>;
  rightSlot?: ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl px-3 py-3 transition-all duration-200 cursor-pointer ${
        isDisabled ? "opacity-70" : ""
      } ${
        isActive
          ? "bg-[rgba(139,92,246,0.08)] border border-[rgba(139,92,246,0.2)]"
          : "border border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`h-2 w-2 rounded-full flex-shrink-0 ${
              isDisabled
                ? "bg-[#52525b]"
                : isActive
                  ? "bg-[#8b5cf6]"
                  : "bg-[#3b3b3b]"
            }`}
          />
          <span
            className={`text-[0.82rem] truncate ${
              isDisabled
                ? "text-[#6b7280]"
                : isActive
                  ? "text-[#f4f4f5] font-medium"
                  : "text-[#f4f4f5]"
            }`}
          >
            {title}
          </span>
          {badges?.map((badge) => (
            <Badge key={badge.label} variant={badge.variant}>
              {badge.label}
            </Badge>
          ))}
        </div>
        {rightSlot}
      </div>
      {subtitle ? (
        <p
          className={`mt-1 truncate text-[0.7rem] pl-4 ${
            isDisabled ? "text-[#4f5868]" : "text-[#d4d4d8]"
          }`}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
