/**
 * @grit/shared-ui — GRITui shared component library for Grit BizSuite.
 *
 * Tailwind v4 utility classes only, no runtime dependencies (React is a peer).
 * Ships TypeScript source: consuming Next.js apps must add "@grit/shared-ui"
 * to `transpilePackages` and include this package's `src` in their Tailwind
 * content sources so the utility classes are generated.
 */

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./Button.js";
export { Input, type InputProps } from "./Input.js";
export { Table, type TableProps, type TableColumn } from "./Table.js";
export { Panel, type PanelProps } from "./Panel.js";
export { Badge, statusVariant, type BadgeProps, type BadgeVariant } from "./Badge.js";
export { EmptyState, type EmptyStateProps } from "./EmptyState.js";
export { AppSwitcher, type AppSwitcherProps, type AppSwitcherItem } from "./AppSwitcher.js";
