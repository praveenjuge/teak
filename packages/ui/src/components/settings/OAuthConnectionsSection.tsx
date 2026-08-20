"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { SettingRow } from "./SettingRow";

export interface OAuthConnection {
  clientId: string;
  connectedAt: number;
  expiresAt?: number;
  name: string;
}

interface OAuthConnectionsSectionProps {
  connections: OAuthConnection[] | undefined;
  onRevoke: (clientId: string) => Promise<void>;
}

export function OAuthConnectionsSection({
  connections,
  onRevoke,
}: OAuthConnectionsSectionProps) {
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const revoke = async (connection: OAuthConnection) => {
    setRevoking(connection.clientId);
    try {
      await onRevoke(connection.clientId);
      toast.success(`${connection.name} disconnected`);
    } catch {
      toast.error("Could not disconnect the app. Please try again.");
    } finally {
      setRevoking(null);
    }
  };

  return (
    <>
      <SettingRow title="Connected apps">
        <Button
          disabled={connections === undefined}
          onClick={() => setOpen(true)}
          size="sm"
          variant="link"
        >
          {connections === undefined ? <Spinner /> : "Manage"}
        </Button>
      </SettingRow>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connected apps</DialogTitle>
            <DialogDescription>
              Disconnect an app to revoke all of its Teak access immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {connections?.length ? (
              connections.map((connection) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                  key={connection.clientId}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">
                      {connection.name}
                    </p>
                    <p className="truncate text-muted-foreground text-xs">
                      {connection.clientId}
                    </p>
                  </div>
                  <Button
                    disabled={revoking !== null}
                    onClick={() => void revoke(connection)}
                    size="sm"
                    variant="outline"
                  >
                    {revoking === connection.clientId ? (
                      <Spinner />
                    ) : (
                      "Disconnect"
                    )}
                  </Button>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-muted-foreground text-sm">
                No apps are connected.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
