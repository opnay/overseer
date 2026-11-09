import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";

type Slot = "actions" | "utilities";
interface SlotHost {
  node: HTMLDivElement | null;
  setNode: Dispatch<SetStateAction<HTMLDivElement | null>>;
  active: boolean;
  setActive: Dispatch<SetStateAction<boolean>>;
}
const Context = createContext<Record<Slot, SlotHost> | undefined>(undefined);

export function PageHeaderSlotsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [utilities, setUtilities] = useState<HTMLDivElement | null>(null);
  const [actionsActive, setActionsActive] = useState(false);
  const [utilitiesActive, setUtilitiesActive] = useState(false);
  return (
    <Context.Provider
      value={{
        actions: {
          node: actions,
          setNode: setActions,
          active: actionsActive,
          setActive: setActionsActive,
        },
        utilities: {
          node: utilities,
          setNode: setUtilities,
          active: utilitiesActive,
          setActive: setUtilitiesActive,
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

function useSlot(name: Slot) {
  const slots = useContext(Context);
  if (!slots) throw new Error("PageHeaderSlotsProvider가 필요합니다.");
  return slots[name];
}

export function PageHeaderSlot({ name, children }: { name: Slot; children: ReactNode }) {
  const { node, setActive } = useSlot(name);
  const active = children !== null && children !== undefined && children !== false;
  useLayoutEffect(() => {
    setActive(active);
    return () => setActive(false);
  }, [active, setActive]);
  return node ? createPortal(children, node) : null;
}

export function PageHeaderSlotOutlet({
  name,
  className,
  children,
}: {
  name: Slot;
  className?: string;
  children?: ReactNode;
}) {
  const { setNode, active } = useSlot(name);
  return (
    <div ref={setNode} className={className} hidden={!active && !children}>
      {children}
    </div>
  );
}
