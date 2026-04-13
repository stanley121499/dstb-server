import { ConfigEditorForm } from "@/components/config-editor-form";
import { DEFAULT_ORB_ATR_PARAMS_JSON } from "@/lib/defaultOrbParams";

/**
 * Create a new config (starts disabled).
 */
export default function NewConfigPage(): React.ReactElement {
  return (
    <ConfigEditorForm
      mode="create"
      initial={{
        name: "",
        strategy: "orb-atr",
        symbol: "BTC-USD",
        interval: "15m",
        exchange: "paper",
        initial_balance: 10000,
        maxDailyLossPct: 5,
        maxPositionSizePct: 100,
        paramsJson: DEFAULT_ORB_ATR_PARAMS_JSON
      }}
    />
  );
}
