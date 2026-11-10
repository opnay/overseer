import { Tooltip } from "@opnay/city-ds-react/tooltip";
import { Toaster } from "@opnay/city-ds-react/toast";
import { BrowserRouter } from "react-router";
import { AppSessionProvider } from "../runtime/AppSession.tsx";
import { StartupGate } from "../startup/StartupGate.tsx";
import { AppShell } from "./AppShell.tsx";
import { WindowFrame } from "./WindowFrame.tsx";

export function App() {
  return (
    <Tooltip.Provider delay={400}>
      <BrowserRouter>
        <AppSessionProvider>
          <WindowFrame>
            <StartupGate>
              <AppShell />
            </StartupGate>
          </WindowFrame>
          <Toaster
            duration={5_000}
            toastOptions={{ closeButtonAriaLabel: "알림 닫기" }}
            visibleToasts={3}
          />
        </AppSessionProvider>
      </BrowserRouter>
    </Tooltip.Provider>
  );
}
