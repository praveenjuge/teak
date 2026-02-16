# @teak/ui

Shared UI package for Teak applications.

## Logo

`@teak/ui/logo` exports the Teak logo + `Early Access` badge component.

```tsx
import Logo from "@teak/ui/logo";

export function Header() {
  return <Logo variant="primary" />;
}
```

### Props

- `variant?: "default" | "primary" | "current"`
