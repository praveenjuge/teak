"use client";

import { Spinner } from "@/components/ui/spinner";
import { AdminDashboardView } from "./_components/AdminDashboardView";
import { useAdminDashboardData } from "./_hooks/useAdminDashboardData";
import { Authenticated, AuthLoading } from "convex/react";
import Loading from "@/app/loading";

export default function AdminPage() {
  const dashboard = useAdminDashboardData();

  if (dashboard.status === "loading") {
    return <Spinner />;
  }

  return (
    <>
      <AuthLoading>
        <Loading />
      </AuthLoading>
      <Authenticated>
        <AdminDashboardView {...dashboard.viewModel} />
      </Authenticated>
    </>
  );
}
