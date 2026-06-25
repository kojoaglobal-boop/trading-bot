const REQUIRED_LIVE_CONFIRMATION = "I_UNDERSTAND_THIS_CAN_LOSE_MONEY";

export function assertLiveTradingAllowed(env = process.env) {
  if (env.TRADING_MODE !== "live") {
    throw new Error("TRADING_MODE is not live");
  }

  if (env.LIVE_TRADING_CONFIRMATION !== REQUIRED_LIVE_CONFIRMATION) {
    throw new Error("missing explicit live-trading confirmation");
  }

  if (env.KILL_SWITCH === "1") {
    throw new Error("kill switch is active");
  }

  return true;
}

export function createBlockedLiveAdapter() {
  return {
    executeOrder() {
      assertLiveTradingAllowed();
      throw new Error("No live broker adapter has been installed yet.");
    }
  };
}
