import { useTranslations } from "@teak/i18n/react";
import { SettingsShell } from "@/screens/SettingsShell";
import { SettingsHeader } from "./SettingsHeader";

const TILE_KEYS = ["plan", "appearance", "integrations", "security", "data"];

function SkeletonBar({ className }: { className: string }) {
  return (
    <span
      className={`block animate-pulse rounded-full bg-muted ${className}`}
    />
  );
}

/** Settings while the app loads: the nav, Account's heading, profile and pages. */
export function SettingsPageSkeleton() {
  const t = useTranslations("settings.skeleton");
  return (
    <div className="flow-root">
      <SettingsShell
        header={<SettingsHeader />}
        nav={
          <div aria-hidden className="space-y-4 px-2.5 pt-2">
            {["a", "b", "c", "d", "e", "f"].map((key) => (
              <SkeletonBar className="h-4 w-28" key={key} />
            ))}
          </div>
        }
      >
        <span className="sr-only" role="status">
          {t("loading")}
        </span>
        <div aria-hidden>
          <div className="space-y-2.5 pb-6">
            <SkeletonBar className="h-5 w-24" />
            <SkeletonBar className="h-4 w-64" />
          </div>
          <div className="flex items-center justify-between gap-4 border-t py-6">
            <span className="space-y-2">
              <SkeletonBar className="h-4 w-24" />
              <SkeletonBar className="h-3.5 w-56" />
            </span>
            <span className="h-8 w-24 rounded-full border" />
          </div>
          <div className="divide-y rounded-xl border">
            {TILE_KEYS.map((key) => (
              <div className="flex items-center gap-3.5 px-4 py-3.5" key={key}>
                <span className="size-[18px] shrink-0 animate-pulse rounded bg-muted" />
                <span className="flex-1 space-y-2">
                  <SkeletonBar className="h-3.5 w-24" />
                  <SkeletonBar className="h-3 w-40" />
                </span>
              </div>
            ))}
          </div>
        </div>
      </SettingsShell>
    </div>
  );
}
