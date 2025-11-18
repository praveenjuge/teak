import { CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function ProfileSettingsPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Profile Settings
      </h1>

      <div className="flex justify-between items-center">
        <div className="space-y-1">
          <CardTitle>Profile Picture</CardTitle>
          <CardDescription>JPG or PNG, at least 512x512px.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Avatar className="size-10 font-semibold">
            <AvatarImage alt="Profile preview" />
            <AvatarFallback>JD</AvatarFallback>
          </Avatar>
          <Button size="sm">Upload</Button>
          <Button size="sm" variant="link">
            Remove
          </Button>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <CardTitle>Name</CardTitle>
        <div className="flex items-center gap-1">
          <span className="font-medium">John Doe</span>
          <Button size="sm" variant="link">
            Edit
          </Button>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <CardTitle>Email</CardTitle>
        <Button disabled size="sm" variant="ghost">
          you@example.com
        </Button>
      </div>

      <div className="flex justify-between items-center">
        <CardTitle>Password</CardTitle>
        <Button size="sm" variant="link">
          Reset password
        </Button>
      </div>

      <div className="flex justify-between items-center">
        <CardTitle>Delete Account</CardTitle>
        <Button size="sm" variant="link">
          Delete
        </Button>
      </div>
    </div>
  );
}
