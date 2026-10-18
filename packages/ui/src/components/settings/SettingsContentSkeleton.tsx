import { SettingRow, SettingValueSkeleton } from "./SettingRow";
import { SettingsFooter } from "./SettingsFooter";

const SKELETON_ROWS: [title: string, width: string][] = [
  ["Email", "w-44"],
  ["Usage", "w-16"],
  ["Plan", "w-28"],
  ["Security", "w-16"],
  ["Import/Export Data", "w-16"],
  ["Theme", "w-24"],
  ["Sign out", "w-16"],
];

export function SettingsContentSkeleton() {
  return (
    <>
      <span className="sr-only" role="status">
        Loading settings…
      </span>
      <p aria-hidden className="font-semibold text-xl tracking-tight">
        Settings
      </p>
      {SKELETON_ROWS.map(([title, width]) => (
        <SettingRow key={title} title={title}>
          <SettingValueSkeleton className={width} />
        </SettingRow>
      ))}
      <SettingsFooter />
    </>
  );
}
