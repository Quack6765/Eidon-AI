"use client";

import { useCallback, useLayoutEffect, useState } from "react";

type UseAutoResizeOptions = {
  ref: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  minHeight?: number;
};

export function useAutoResize({ ref, value, minHeight = 40 }: UseAutoResizeOptions) {
  const [height, setHeight] = useState<number>(minHeight);

  const adjustHeight = useCallback(() => {
    const textarea = ref.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const scrollHeight = textarea.scrollHeight;
    const newHeight = Math.max(minHeight, scrollHeight);
    textarea.style.height = `${newHeight}px`;
    setHeight(newHeight);
  }, [ref, minHeight]);

  useLayoutEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  return { height };
}
