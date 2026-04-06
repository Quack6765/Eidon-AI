"use client";

import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

type ContextGaugeProps = {
  usedTokens: number | null;
  usableLimit: number;
  maxLimit: number;
};

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    const value = tokens / 1000;
    return value >= 100 ? `${Math.round(value)}K` : `${value.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(tokens);
}

function getGaugeColor(percentage: number): string {
  if (percentage >= 70) return "#ef4444"; // red-500
  if (percentage >= 50) return "#eab308"; // yellow-500
  return "#22c55e"; // green-500
}

export function ContextGauge({ usedTokens, usableLimit, maxLimit }: ContextGaugeProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (usedTokens === null) {
    return null;
  }

  const percentage = Math.min(100, (usedTokens / usableLimit) * 100);
  const color = getGaugeColor(percentage);

  // SVG circle properties
  const size = 20;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percentage / 100);

  const handleMouseEnter = useCallback(() => {
    setShowTooltip(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setShowTooltip(false);
  }, []);

  const handleClick = useCallback(() => {
    setShowTooltip((prev) => !prev);
  }, []);

  const usedFormatted = formatTokens(usedTokens);
  const usableFormatted = formatTokens(usableLimit);
  const maxFormatted = formatTokens(maxLimit);
  const thresholdPercent = Math.round((usableLimit / maxLimit) * 100);

  return (
    <div className="relative flex items-center gap-1.5">
      <button
        type="button"
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${Math.round(percentage)}% context used`}
        className="flex items-center justify-center p-1 rounded-lg hover:bg-white/5 transition-colors"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          style={{ transform: "rotate(-90deg)" }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 0.3s ease-out" }}
          />
        </svg>
      </button>
      <span className="text-[10px] text-white/40">{usedFormatted}</span>

      {showTooltip && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-lg bg-[#27272a] border border-white/10 shadow-lg whitespace-nowrap z-50"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="text-[11px] text-white/70">
            {usedFormatted} used
          </div>
          <div className="text-[11px] text-white/50">
            {usableFormatted} usable ({thresholdPercent}% of {maxFormatted})
          </div>
        </div>
      )}
    </div>
  );
}