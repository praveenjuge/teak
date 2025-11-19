"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useAction, useMutation } from "convex/react";
import { api } from "@teak/convex";
import { authClient } from "@/lib/auth-client";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertCircle,
  AlertTriangle,
  Monitor,
  Moon,
  Sun,
  CheckCircle2,
  ArrowRight,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "next-themes";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";
import { cn } from "@/lib/utils";

const featureList = [
  "Unlimited Cards",
  "Unlimited Storage",
  "Automatic Summary and Tags",
  "Automatic Audio Transcription",
  "Chrome Extension",
  "iOS Mobile App",
  "Android Mobile App",
];

const themeOptions = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

type ThemeValue = (typeof themeOptions)[number]["value"];

type AvatarState = {
  uploading: boolean;
  error: string | null;
};

type PasswordState = {
  open: boolean;
  current: string;
  next: string;
  confirm: string;
  error: string | null;
  loading: boolean;
};

type DeleteState = {
  open: boolean;
  confirmation: string;
  error: string | null;
  loading: boolean;
};

type PasswordFieldName = "current" | "next" | "confirm";

const passwordFields: Array<{
  id: string;
  label: string;
  placeholder: string;
  field: PasswordFieldName;
}> = [
  {
    id: "currentPassword",
    label: "Current password",
    placeholder: "Current password",
    field: "current",
  },
  {
    id: "newPassword",
    label: "New password",
    placeholder: "New password",
    field: "next",
  },
  {
    id: "confirmPassword",
    label: "Confirm new password",
    placeholder: "Re-enter new password",
    field: "confirm",
  },
];

function useObjectState<T extends Record<string, any>>(
  createInitialState: () => T
) {
  const [state, setState] = useState<T>(createInitialState);
  const patch = (patchValue: Partial<T>) =>
    setState((prev) => ({ ...prev, ...patchValue }));
  const reset = () => setState(createInitialState());
  const setField = <K extends keyof T>(key: K, value: T[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));
  return { state, patch, reset, setField } as const;
}

function ErrorAlert({
  message,
  title = "Error",
  icon: Icon = AlertCircle,
}: {
  message?: string | null;
  title?: string;
  icon?: LucideIcon;
}) {
  if (!message) return null;

  return (
    <Alert variant="destructive">
      <Icon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function SettingRow({
  title,
  children,
  align = "center",
}: {
  title: string;
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap justify-between gap-3",
        align === "start" ? "items-start" : "items-center"
      )}
    >
      <CardTitle>{title}</CardTitle>
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 justify-end",
          align === "start" && "text-right"
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface CustomerPortalButtonProps {
  className?: string;
  children: ReactNode;
}

function CustomerPortalButton({
  className,
  children,
}: CustomerPortalButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  // @ts-ignore
  const createCustomerPortal = useAction(api.billing.createCustomerPortal);

  const handlePortal = async () => {
    setIsLoading(true);
    try {
      const portalUrl = await createCustomerPortal({});
      window.open(portalUrl, "_blank");
    } catch (error) {
      console.error("Failed to open customer portal", error);
      toast.error("Failed to open customer portal. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button onClick={handlePortal} className={className} disabled={isLoading}>
      {isLoading ? <Spinner /> : children}
    </button>
  );
}

interface PlanOptionProps {
  planId: string;
  title: string;
  priceAmount: number;
  intervalLabel: string;
  badge?: string;
  isLoading: boolean;
  onCheckout: (planId: string) => void;
}

function PlanOption({
  planId,
  title,
  priceAmount,
  intervalLabel,
  badge,
  isLoading,
  onCheckout,
}: PlanOptionProps) {
  const formattedPrice = priceAmount
    ? `${(priceAmount / 100).toLocaleString()}$`
    : "--";

  return (
    <div className="flex w-full flex-col justify-between rounded-md border bg-background p-5 text-left gap-4 relative overflow-hidden">
      {badge && (
        <Badge className="rounded-none absolute top-0 right-0 rounded-bl-md px-3">
          {badge}
        </Badge>
      )}
      <p className="font-medium text-muted-foreground">{title}</p>
      <div className="flex justify-between items-end">
        <div className="flex gap-2 items-end">
          <p className="text-4xl font-semibold text-foreground">
            {formattedPrice}
          </p>
          <p className="text-muted-foreground pb-1">{intervalLabel}</p>
        </div>

        <button
          onClick={() => onCheckout(planId)}
          className={cn(
            buttonVariants({
              variant: "outline",
            })
          )}
          disabled={isLoading}
        >
          {isLoading ? (
            <Spinner />
          ) : (
            <span className="flex items-center gap-2">
              Continue <ArrowRight className="size-4" />
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

interface SubscriptionSectionProps {
  onCheckout: (planId: string) => void;
  loadingPlanId: string | null;
}

function SubscriptionSection({
  onCheckout,
  loadingPlanId,
}: SubscriptionSectionProps) {
  const isProduction = process.env.NODE_ENV === "production";
  const monthlyPlanId = isProduction
    ? "d46c71a7-61dc-4dc8-b53d-9a73d0204c28"
    : "a02153cd-c49d-49ae-8be6-464296a39a23";
  const yearlyPlanId = isProduction
    ? "6fb24b68-09e0-42c4-b090-f0e03cb7de56"
    : "f3073c34-8b4d-40b7-8123-2f8cbacbc609";

  const plans = [
    {
      planId: monthlyPlanId,
      title: "Monthly",
      priceAmount: 1900,
      intervalLabel: "Per Month",
    },
    {
      planId: yearlyPlanId,
      title: "Yearly",
      priceAmount: 9900,
      intervalLabel: "Per Year",
      badge: "Best Value • 20% off",
    },
  ];

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle>Upgrade to Pro</DialogTitle>
        <DialogDescription>
          Unlock all features and remove limits.
        </DialogDescription>
      </DialogHeader>

      {plans.map((plan) => (
        <PlanOption
          key={plan.planId}
          {...plan}
          isLoading={loadingPlanId === plan.planId}
          onCheckout={onCheckout}
        />
      ))}

      <div className="space-y-3 text-left rounded-md bg-muted/30 p-4">
        <p className="font-medium text-sm text-muted-foreground">
          Pro Features included:
        </p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {featureList.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-primary shrink-0" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function ProfileSettingsPage() {
  // @ts-ignore
  const user = useQuery(api.auth.getCurrentUser);
  // @ts-ignore
  const cardCount = useQuery(api.cards.getCardCount, {});
  // @ts-ignore
  const hasPremium = useQuery(api.billing.userHasPremium, {});
  // @ts-ignore
  const deleteAccount = useMutation(api.users.deleteAccount);
  const prepareAvatarUpload = useMutation(api.users.prepareAvatarUpload);
  const finalizeAvatarUpload = useAction(api.users.finalizeAvatarUpload);
  const removeAvatar = useAction(api.users.removeAvatar);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [checkoutInstance, setCheckoutInstance] = useState<any>(null);
  const { state: avatarState, patch: patchAvatarState } =
    useObjectState<AvatarState>(() => ({
      uploading: false,
      error: null,
    }));
  const {
    state: passwordState,
    patch: patchPasswordState,
    reset: resetPasswordState,
    setField: setPasswordField,
  } = useObjectState<PasswordState>(() => ({
    open: false,
    current: "",
    next: "",
    confirm: "",
    error: null,
    loading: false,
  }));
  const {
    state: deleteState,
    patch: patchDeleteState,
    reset: resetDeleteState,
    setField: setDeleteField,
  } = useObjectState<DeleteState>(() => ({
    open: false,
    confirmation: "",
    error: null,
    loading: false,
  }));
  // @ts-ignore
  const createCheckoutLink = useAction(api.billing.createCheckoutLink);
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    return () => {
      checkoutInstance?.close();
    };
  }, [checkoutInstance]);

  const handleCheckout = async (planId: string) => {
    setLoadingPlanId(planId);
    try {
      const checkoutUrl = await createCheckoutLink({ productId: planId });
      const checkout = await PolarEmbedCheckout.create(checkoutUrl, "light");

      setCheckoutInstance(checkout);
      setSubscriptionOpen(false);

      checkout.addEventListener("success", (event: any) => {
        if (!event.detail.redirect) {
          toast.success(
            "Welcome to Pro! Your subscription has been activated."
          );
        }
      });

      checkout.addEventListener("close", () => {
        setCheckoutInstance(null);
      });
    } catch (error) {
      console.error("Failed to open checkout", error);
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setLoadingPlanId(null);
    }
  };

  const userInitials = useMemo(() => {
    if (!user?.email) return "U";
    const [local] = user.email.split("@");
    const parts = local.split(".").filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return local.slice(0, 2).toUpperCase();
  }, [user?.email]);

  useEffect(() => {
    if (!isEditingName) {
      setNameInput(user?.name ?? "");
    }
  }, [isEditingName, user?.name]);

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();

    setIsSaving(true);
    try {
      await authClient.updateUser(
        { name: trimmed },
        {
          onSuccess: () => {
            setIsEditingName(false);
          },
          onError: (ctx) => {
            toast.error(ctx.error?.message ?? "Failed to update name");
          },
        }
      );
    } catch (error) {
      toast.error("Something went wrong while updating your name.");
    } finally {
      setIsSaving(false);
    }
  };

  const nameMissing = (user?.name ?? "").trim() === "";
  const displayName = nameMissing ? "" : (user?.name ?? nameInput);
  const isLoading = user === undefined;
  const avatarUrl = user?.imageUrl ?? user?.image ?? undefined;

  const handleAvatarFileChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    patchAvatarState({ error: null, uploading: true });

    try {
      const { uploadUrl } = await prepareAvatarUpload({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });

      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Upload failed");
      }

      const { storageId } = await uploadResponse.json();

      await finalizeAvatarUpload({ fileId: storageId });
      toast.success("Profile picture updated");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong while uploading.";
      patchAvatarState({ error: message });
      toast.error(message);
    } finally {
      patchAvatarState({ uploading: false });
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const handleAvatarRemove = async () => {
    patchAvatarState({ error: null, uploading: true });
    try {
      await removeAvatar({});
      toast.success("Profile picture removed");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to remove profile picture.";
      patchAvatarState({ error: message });
      toast.error(message);
    } finally {
      patchAvatarState({ uploading: false });
    }
  };

  const handlePasswordFieldChange =
    (field: PasswordFieldName) => (event: ChangeEvent<HTMLInputElement>) =>
      setPasswordField(field, event.target.value);

  const handleResetPassword = async () => {
    patchPasswordState({ error: null });

    if (passwordState.next !== passwordState.confirm) {
      patchPasswordState({
        error: "New password and confirmation do not match.",
      });
      return;
    }

    patchPasswordState({ loading: true });
    try {
      await authClient.changePassword(
        {
          currentPassword: passwordState.current,
          newPassword: passwordState.next,
          revokeOtherSessions: true,
        },
        {
          onSuccess: () => {
            toast.success("Password updated");
            resetPasswordState();
          },
          onError: (ctx) => {
            patchPasswordState({
              error: ctx.error?.message ?? "Failed to update password",
            });
          },
        }
      );
    } catch (error) {
      patchPasswordState({
        error: "Something went wrong while updating your password.",
      });
    } finally {
      patchPasswordState({ loading: false });
    }
  };

  const handlePasswordDialogChange = (open: boolean) => {
    if (open) {
      patchPasswordState({ open: true });
    } else {
      resetPasswordState();
    }
  };

  const confirmationMatches =
    deleteState.confirmation.trim().toLowerCase() === "delete account";

  const handleDeleteAccount = async () => {
    if (!confirmationMatches) {
      toast.error('Type "delete account" to confirm.');
      return;
    }

    patchDeleteState({ loading: true, error: null });

    try {
      await deleteAccount({});

      let deleteUserFailed = false;
      await authClient.deleteUser(undefined, {
        onSuccess: async () => {
          //@ts-ignore
          router.push("/login");
        },
        onError: (ctx) => {
          patchDeleteState({
            error: ctx.error?.message ?? "Failed to delete account.",
          });
          deleteUserFailed = true;
        },
      });

      if (deleteUserFailed) {
        return;
      }

      resetDeleteState();
    } catch (error) {
      patchDeleteState({
        error: "Something went wrong while deleting your account.",
      });
    } finally {
      patchDeleteState({ loading: false });
    }
  };

  const handleDeleteDialogChange = (open: boolean) => {
    if (open) {
      patchDeleteState({ open: true });
    } else {
      resetDeleteState();
    }
  };

  const handleDeleteConfirmationChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => setDeleteField("confirmation", event.target.value);

  const handleSignOut = async () => {
    setSignOutLoading(true);
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push("/");
          },
        },
      });
    } catch (error) {
      toast.error("Failed to sign out. Please try again.");
    } finally {
      setSignOutLoading(false);
    }
  };

  const handleThemeChange = (value: ThemeValue) => () => setTheme(value);

  return (
    <>
      <Link href="/" className="text-primary inline-block font-medium">
        &larr; Back to Teak
      </Link>

      <Separator />

      <h1 className="text-xl font-semibold tracking-tight">Profile</h1>

      <SettingRow title="Profile Picture" align="start">
        <Avatar className="size-7 text-xs font-semibold">
          <AvatarImage
            alt="Profile preview"
            className="object-cover"
            src={avatarUrl}
          />
          <AvatarFallback>{userInitials}</AvatarFallback>
        </Avatar>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarFileChange}
        />
        <Button
          size="sm"
          variant="link"
          disabled={avatarState.uploading}
          onClick={() => avatarInputRef.current?.click()}
        >
          {avatarState.uploading ? <Spinner /> : "Upload"}
        </Button>
        {avatarUrl ? (
          <>
            <span className="text-border -mx-2">|</span>
            <Button
              size="sm"
              variant="link"
              disabled={avatarState.uploading}
              onClick={handleAvatarRemove}
            >
              Remove
            </Button>
          </>
        ) : null}
      </SettingRow>

      <ErrorAlert message={avatarState.error} title="Upload failed" />

      <SettingRow title="Name">
        {isEditingName ? (
          <>
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Add your name"
              className="w-48"
            />
            <Button size="sm" onClick={handleSaveName} disabled={isSaving}>
              {isSaving ? <Spinner /> : "Save"}
            </Button>
          </>
        ) : isLoading ? (
          <Button disabled size="sm" variant="ghost">
            <Spinner />
          </Button>
        ) : displayName ? (
          <>
            <span className="font-medium">{displayName}</span>
            <Button
              size="sm"
              variant="link"
              onClick={() => setIsEditingName(true)}
            >
              Edit
            </Button>
          </>
        ) : (
          <>
            <Button disabled size="sm" variant="ghost" className="-mr-4">
              No name added yet
            </Button>
            <Button
              size="sm"
              variant="link"
              onClick={() => setIsEditingName(true)}
            >
              Add
            </Button>
          </>
        )}
      </SettingRow>

      <SettingRow title="Email">
        <Button disabled size="sm" variant="ghost">
          {isLoading ? <Spinner /> : (user?.email ?? "Not available")}
        </Button>
      </SettingRow>

      <SettingRow title="Password">
        <Button
          size="sm"
          variant="link"
          onClick={() => patchPasswordState({ open: true })}
        >
          Reset password
        </Button>
      </SettingRow>

      <SettingRow title="Theme">
        <div className="flex items-center gap-px">
          {themeOptions.map(({ value, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? "secondary" : "ghost"}
              size="sm"
              onClick={handleThemeChange(value)}
            >
              <Icon />
            </Button>
          ))}
        </div>
      </SettingRow>

      <SettingRow title="Sign out">
        <Button
          size="sm"
          variant="link"
          onClick={handleSignOut}
          disabled={signOutLoading}
        >
          {signOutLoading ? <Spinner /> : "Sign out"}
        </Button>
      </SettingRow>

      <SettingRow title="Delete Account">
        <Button
          size="sm"
          variant="link"
          onClick={() => patchDeleteState({ open: true })}
        >
          Delete
        </Button>
      </SettingRow>

      <Separator />

      <h1 className="text-xl font-semibold tracking-tight">Subscription</h1>

      <SettingRow title="Current Usage">
        <Button size="sm" variant="ghost" disabled>
          {cardCount ?? 0} cards used
        </Button>
      </SettingRow>

      <SettingRow title="Current Plan">
        {hasPremium ? (
          <>
            <Badge>Pro</Badge>
            <CustomerPortalButton
              className={cn(buttonVariants({ variant: "link", size: "sm" }))}
            >
              <span className="flex items-center gap-1">
                Manage
                <ExternalLink className="size-4" />
              </span>
            </CustomerPortalButton>
          </>
        ) : (
          <>
            <Badge variant="outline">Free Plan</Badge>
            <Button
              size="sm"
              variant="link"
              onClick={() => setSubscriptionOpen(true)}
            >
              Upgrade
            </Button>
          </>
        )}
      </SettingRow>

      <Dialog open={subscriptionOpen} onOpenChange={setSubscriptionOpen}>
        <DialogContent className="max-w-3xl">
          <SubscriptionSection
            onCheckout={handleCheckout}
            loadingPlanId={loadingPlanId}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={passwordState.open}
        onOpenChange={handlePasswordDialogChange}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <ErrorAlert message={passwordState.error} />

            {passwordFields.map(({ id, label, placeholder, field }) => (
              <div className="space-y-2" key={id}>
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id}
                  type="password"
                  value={passwordState[field]}
                  onChange={handlePasswordFieldChange(field)}
                  placeholder={placeholder}
                />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              onClick={handleResetPassword}
              disabled={passwordState.loading}
            >
              {passwordState.loading ? <Spinner /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteState.open} onOpenChange={handleDeleteDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              This action permanently removes your account, cards, and uploaded
              files.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Permanent and irreversible</AlertTitle>
              <AlertDescription>
                All of your cards, tags, and stored files will be deleted. This
                cannot be undone.
              </AlertDescription>
            </Alert>

            <ErrorAlert message={deleteState.error} />

            <div className="space-y-2">
              <Label htmlFor="deleteConfirm">
                Type "delete account" to proceed
              </Label>
              <Input
                id="deleteConfirm"
                value={deleteState.confirmation}
                onChange={handleDeleteConfirmationChange}
                placeholder="delete account"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={!confirmationMatches || deleteState.loading}
            >
              {deleteState.loading ? <Spinner /> : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
