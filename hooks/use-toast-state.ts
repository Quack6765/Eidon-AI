import { useCallback, useRef, useState } from "react";

type ToastVariant = "success" | "error" | "warning" | "info";

type ToastState = {
  visible: boolean;
  message: string;
  variant: ToastVariant;
};

export function useToastState() {
  const [state, setState] = useState<ToastState>({
    visible: false,
    message: "",
    variant: "success",
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((variant: ToastVariant, message: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState({ visible: true, message, variant });
    timerRef.current = setTimeout(() => {
      setState((prev) => ({ ...prev, visible: false }));
    }, 2000);
  }, []);

  const dismissToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState((prev) => ({ ...prev, visible: false }));
  }, []);

  return { ...state, showToast, dismissToast };
}
