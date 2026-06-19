"use client";

import { useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ImportDialog } from "./ImportDialog";
import { SettingRow } from "./SettingRow";

export function ImportSection() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  return (
    <>
      <SettingRow title="Import Data">
        {active ? <Badge variant="secondary">Importing</Badge> : null}
        <Button onClick={() => setOpen(true)} size="sm" variant="link">
          Import
        </Button>
      </SettingRow>
      <ImportDialog
        onActiveChange={setActive}
        onOpenChange={setOpen}
        open={open}
      />
    </>
  );
}
