export type LoadingStageState = "pending" | "active" | "done";

export type LoadingStageFlags = {
  linkValid: boolean;
  authDone: boolean;
  networkChecked: boolean;
  challengeReady: boolean;
};

export function loadingViewMode(oauthReturn: boolean): "compact" | "checklist" {
  return oauthReturn ? "checklist" : "compact";
}

export function stageStates({
  linkValid,
  authDone,
  networkChecked,
  challengeReady,
}: LoadingStageFlags): [LoadingStageState, LoadingStageState, LoadingStageState] {
  return [
    authDone ? "done" : linkValid ? "active" : "pending",
    networkChecked ? "done" : authDone ? "active" : "pending",
    challengeReady ? "done" : networkChecked ? "active" : "pending",
  ];
}
