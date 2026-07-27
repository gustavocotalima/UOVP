export function isIosLike({
  userAgent,
  platform,
  maxTouchPoints,
}: {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}) {
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function isStandaloneMode({
  displayModeMatches,
  navigatorStandalone,
}: {
  displayModeMatches: boolean;
  navigatorStandalone?: boolean;
}) {
  return displayModeMatches || navigatorStandalone === true;
}
