export const PORTFOLIO_SIMULATION_INVALIDATED_EVENT = "portfolio:simulation-invalidated";

export function notifyPortfolioSimulationInvalidated() {
  window.dispatchEvent(new Event(PORTFOLIO_SIMULATION_INVALIDATED_EVENT));
}
