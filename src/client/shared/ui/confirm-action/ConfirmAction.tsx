import { AlertDialog } from "@opnay/city-ds-react/alert-dialog";
import { Button } from "@opnay/city-ds-react/button";
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
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        disabled={disabled}
        render={<Button aria-label={ariaLabel} iconOnly={iconOnly} size="sm" variant="ghost" />}
      >
        {children}
      </AlertDialog.Trigger>
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
