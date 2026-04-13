import { Tooltip, ActionIcon } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";

interface HelpIconProps {
  label: string;
  size?: number;
}

/**
 * Compact help indicator — a small ⓘ icon that shows a tooltip on hover.
 * Use this to replace inline explanatory paragraphs next to labels or headings.
 *
 * @example
 * <label>Source <HelpIcon label="Built-in categories come from the default template..." /></label>
 */
export function HelpIcon({ label, size = 14 }: HelpIconProps) {
  return (
    <Tooltip label={label} withArrow multiline maw={280} position="top">
      <ActionIcon
        variant="transparent"
        size="xs"
        color="gray"
        style={{ verticalAlign: "middle", cursor: "help" }}
        aria-label="Help"
        tabIndex={0}
      >
        <IconInfoCircle size={size} />
      </ActionIcon>
    </Tooltip>
  );
}
