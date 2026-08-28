import { AlertDialog } from "@opnay/city-ds-react/alert-dialog";
import { Button } from "@opnay/city-ds-react/button";
import { Tooltip } from "@opnay/city-ds-react/tooltip";
import type { ReactNode } from "react";

export function ConfirmAction({
  actionLabel,
  ariaLabel,
  children,
  description,
  disabled,
  iconOnly = false,
  onConfirm,
  title,
}: {
  actionLabel: string;
  ariaLabel?: string;
  children: ReactNode;
  description: string;
  disabled?: boolean;
  iconOnly?: boolean;
  onConfirm: () => void;
  title: string;
}) {
  const trigger = (
    <AlertDialog.Trigger
      disabled={disabled}
      render={<Button aria-label={ariaLabel} iconOnly={iconOnly} size="sm" variant="ghost" />}
    >
      {children}
    </AlertDialog.Trigger>
  );

  return (
    <AlertDialog.Root>
      {iconOnly ? (
        <Tooltip.Root>
          <Tooltip.Trigger render={trigger} />
          <Tooltip.Portal>
            <Tooltip.Positioner align="end" side="top" sideOffset={6}>
              <Tooltip.Popup>{ariaLabel ?? actionLabel}</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      ) : (
        trigger
      )}
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Viewport>
          <AlertDialog.Popup>
            <AlertDialog.Title>{title}</AlertDialog.Title>
            <AlertDialog.Description>{description}</AlertDialog.Description>
            <div className="overseer-dialog-actions">
              <AlertDialog.Cancel render={<Button variant="outline" />}>취소</AlertDialog.Cancel>
              <AlertDialog.Action
                destructive
                onClick={onConfirm}
                render={<Button variant="destructive" />}
              >
                {actionLabel}
              </AlertDialog.Action>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
