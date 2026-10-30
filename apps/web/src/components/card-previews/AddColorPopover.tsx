import type { Doc } from "@teak/convex/_generated/dataModel";
import { parsePaletteHex } from "@teak/convex/shared/utils/colorUtils";
import { useTranslations } from "@teak/i18n/react";
import { type FormEvent, useId, useRef, useState } from "react";
import { Plus } from "vadivam-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { paletteHasColor } from "@/hooks/paletteColors";

const DEFAULT_PICKER_HEX = "#FF5500";

interface AddColorPopoverProps {
  colors: Doc<"cards">["colors"];
  onAddColor: (hex: string) => Promise<boolean>;
}

/** "Add color" under a palette: a color picker and a hex field. */
export function AddColorPopover({ colors, onAddColor }: AddColorPopoverProps) {
  const t = useTranslations("cardPreviews.palette");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  // The color being saved shows in the palette at once, so it isn't a
  // duplicate while its save is on its way.
  const [saving, setSaving] = useState(false);
  const problemId = useId();
  const hexInputRef = useRef<HTMLInputElement>(null);

  const hex = parsePaletteHex(text);
  const isTaken = !saving && hex !== null && paletteHasColor(colors, hex);
  let problem: string | null = null;
  if (text.trim() && !hex) {
    problem = t("invalidHex");
  } else if (hex && isTaken) {
    problem = t("alreadyAdded", { hex });
  }
  const canAdd = hex !== null && !isTaken && !saving;

  const save = async (value: string) => {
    // A failed save keeps the typed color, so trying again is one click.
    setSaving(true);
    try {
      if (await onAddColor(value)) {
        setOpen(false);
        setText("");
      }
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canAdd && hex) {
      save(hex).catch(() => undefined);
    }
  };

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setText("");
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          <Plus aria-hidden />
          {t("addColor")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64"
        onOpenAutoFocus={(event) => {
          // The hex field, not the picker before it: most colors are pasted.
          event.preventDefault();
          hexInputRef.current?.focus();
        }}
      >
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <div className="flex items-center gap-2">
            <label
              className="relative size-9 flex-none cursor-pointer overflow-hidden rounded-md border"
              style={{ backgroundColor: hex ?? DEFAULT_PICKER_HEX }}
            >
              <span className="sr-only">{t("pickColor")}</span>
              <input
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                disabled={saving}
                onChange={(event) => {
                  setText(event.target.value.toUpperCase());
                }}
                type="color"
                value={(hex ?? DEFAULT_PICKER_HEX).toLowerCase()}
              />
            </label>
            <Input
              aria-describedby={problem ? problemId : undefined}
              aria-invalid={problem ? true : undefined}
              aria-label={t("hexCode")}
              autoComplete="off"
              className="font-mono"
              onChange={(event) => {
                setText(event.target.value);
              }}
              placeholder={DEFAULT_PICKER_HEX}
              // Held while a color saves, so a closing popover can't take
              // newer typing with it.
              readOnly={saving}
              ref={hexInputRef}
              spellCheck={false}
              value={text}
            />
          </div>
          {problem ? (
            <p className="text-destructive text-sm" id={problemId}>
              {problem}
            </p>
          ) : null}
          <Button disabled={!canAdd} size="sm" type="submit">
            {t("add")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
