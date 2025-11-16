import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function ProfileSettingsPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Profile Settings
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile Picture</CardTitle>
          <CardDescription>JPG or PNG, at least 512x512px.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-6">
            <Avatar className="size-16">
              <AvatarImage
                src="https://placehold.co/128x128"
                alt="Profile preview"
              />
              <AvatarFallback>YOU</AvatarFallback>
            </Avatar>
            <div className="flex flex-wrap gap-3">
              <Button type="button">Upload new photo</Button>
              <Button type="button" variant="outline">
                Remove
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account basics</CardTitle>
          <CardDescription>
            Update your display name and email address.
          </CardDescription>
          <CardAction>
            <Button type="button">Save changes</Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <form className="space-y-6">
            <div className="grid gap-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                placeholder="Praveen Juge"
                defaultValue="Praveen Juge"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@teak.so"
                defaultValue="you@teak.so"
              />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Rotate your password every few months to stay safe.
          </CardDescription>
          <CardAction>
            <Button type="button">Update password</Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                placeholder="••••••••"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Minimum 8 characters"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Re-enter new password"
              />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>
            Permanently wipe your cards, uploads, and user data. This cannot be
            undone.
          </CardDescription>
          <CardAction>
            <Button type="button" variant="destructive">
              Delete account
            </Button>
          </CardAction>
        </CardHeader>
      </Card>
    </div>
  );
}
