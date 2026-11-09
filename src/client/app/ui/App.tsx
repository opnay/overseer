import { Toaster } from "@opnay/city-ds-react/toast";
import { BrowserRouter } from "react-router";
import { AppSessionProvider } from "../runtime/AppSession.tsx";
import { StartupGate } from "../startup/StartupGate.tsx";
import { AppShell } from "./AppShell.tsx";

export function App() {
  return (
    <BrowserRouter>
      <AppSessionProvider>
        <StartupGate>
          <AppShell />
        </StartupGate>
        <Toaster
          duration={5_000}
          toastOptions={{ closeButtonAriaLabel: "알림 닫기" }}
          visibleToasts={3}
        />
      </AppSessionProvider>
    </BrowserRouter>
  );
}
