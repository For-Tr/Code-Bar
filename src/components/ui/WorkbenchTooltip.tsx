import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

export function WorkbenchTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={6}
            style={{
              background: "rgba(28, 28, 30, 0.96)",
              color: "rgba(245, 245, 247, 0.92)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 4,
              padding: "4px 7px",
              fontSize: 10,
              lineHeight: 1,
              boxShadow: "0 6px 16px rgba(0,0,0,0.22)",
              zIndex: 1000,
            }}
          >
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
