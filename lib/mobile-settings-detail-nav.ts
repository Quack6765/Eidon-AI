export type MobileSettingsDetail = {
  title: string;
  backLabel: string;
};

type Detail = MobileSettingsDetail | null;

let currentDetail: Detail = null;
let currentOnBack: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeMobileSettingsDetailNav(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMobileSettingsDetailNavSnapshot(): Detail {
  return currentDetail;
}

export function setMobileSettingsDetailNav(detail: {
  title: string;
  backLabel: string;
  onBack: () => void;
}) {
  currentOnBack = detail.onBack;
  if (
    currentDetail &&
    currentDetail.title === detail.title &&
    currentDetail.backLabel === detail.backLabel
  ) {
    return;
  }
  currentDetail = { title: detail.title, backLabel: detail.backLabel };
  emit();
}

export function clearMobileSettingsDetailNav() {
  currentOnBack = null;
  if (currentDetail === null) {
    return;
  }
  currentDetail = null;
  emit();
}

export function backMobileSettingsDetailNav() {
  currentOnBack?.();
}
