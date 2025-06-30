import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Welcome to Teak</h1>
      <p className="text-muted-foreground">
        This is the home page. Navigate to the{" "}
        <Link to="/login" className="text-blue-600 hover:underline">
          login page
        </Link>{" "}
        to see the login form.
      </p>
    </div>
  );
}
