import type { ComponentProps } from "react";

// Use native navigation: the pinned framework's production Link shim can lose
// dynamic navigation exports during bundling. All classroom data is persisted.
export default function ClassroomLink(props: ComponentProps<"a">) {
  return <a {...props} />;
}
