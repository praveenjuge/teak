import {
  useAdminStats,
  useJobs,
  useRefetchOgImages,
  useRefetchScreenshots,
  useUsers,
} from '@teak/shared-queries';
import {
  BarChart3,
  Bot,
  Briefcase,
  Key,
  LogOut,
  RefreshCw,
  Settings,
  User,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { apiClient } from '@/lib/api';
import { authClient, useSession } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

type SettingsSection =
  | 'general'
  | 'ai'
  | 'api-keys'
  | 'users'
  | 'statistics'
  | 'jobs';

interface NavigationItem {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavigationGroup {
  title: string;
  items: NavigationItem[];
}

export default function SettingsModal() {
  const { data: session } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>('general');

  // Job-related hooks
  const { data: jobs, isLoading: jobsLoading } = useJobs(apiClient);
  const refetchOgImagesMutation = useRefetchOgImages(apiClient);
  const refetchScreenshotsMutation = useRefetchScreenshots(apiClient);

  // Admin hooks
  const { data: adminStats, isLoading: adminStatsLoading } =
    useAdminStats(apiClient);
  const { data: users, isLoading: usersLoading } = useUsers(apiClient);

  const navigationGroups: NavigationGroup[] = [
    {
      title: '',
      items: [
        { id: 'general', label: 'General', icon: User },
        { id: 'ai', label: 'AI', icon: Bot },
        { id: 'api-keys', label: 'API Keys', icon: Key },
      ],
    },
    {
      title: 'ADMIN',
      items: [
        { id: 'statistics', label: 'Statistics', icon: BarChart3 },
        { id: 'users', label: 'Users', icon: Users },
        { id: 'jobs', label: 'Jobs', icon: Briefcase },
      ],
    },
  ];

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      window.location.reload();
      setSettingsOpen(false);
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  };

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="mb-4 font-medium text-lg">General Settings</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span>{session?.user.email}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Theme</span>
                  <ThemeToggle />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    You Are Logged In
                  </span>
                  <Button onClick={handleSignOut} size="sm" variant="outline">
                    <LogOut className="mr-2 size-4" />
                    Logout
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      case 'ai':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="mb-4 font-medium text-lg">AI Settings</h3>
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  AI configuration and preferences will be available here.
                </p>
              </div>
            </div>
          </div>
        );
      case 'api-keys':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="mb-4 font-medium text-lg">API Keys</h3>
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Manage your API keys and authentication settings.
                </p>
              </div>
            </div>
          </div>
        );
      case 'users':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="mb-4 font-medium text-lg">User Management</h3>

              {usersLoading ? (
                <div className="text-center text-muted-foreground">
                  Loading users...
                </div>
              ) : users && users.length > 0 ? (
                <div className="rounded-lg border">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="p-3 text-left font-medium">Name</th>
                        <th className="p-3 text-left font-medium">Email</th>
                        <th className="p-3 text-left font-medium">Role</th>
                        <th className="p-3 text-left font-medium">Status</th>
                        <th className="p-3 text-left font-medium">Joined</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {users.map((user, index) => (
                        <tr className="hover:bg-muted/20" key={user.id}>
                          <td className="p-3 font-medium">{user.name}</td>
                          <td className="p-3 text-muted-foreground">
                            {user.email}
                          </td>
                          <td className="p-3">
                            {index === 0 ? (
                              <span className="rounded bg-orange-100 px-2 py-1 font-medium text-orange-700 text-xs">
                                Admin
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                User
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div
                                className={cn(
                                  'size-2 rounded-full',
                                  user.emailVerified
                                    ? 'bg-green-500'
                                    : 'bg-yellow-500'
                                )}
                              />
                              <span>
                                {user.emailVerified ? 'Verified' : 'Unverified'}
                              </span>
                            </div>
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {new Date(user.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center text-muted-foreground">
                  No users found.
                </div>
              )}
            </div>
          </div>
        );
      case 'statistics':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="mb-4 font-medium text-lg">System Statistics</h3>

              {adminStatsLoading ? (
                <div className="text-center text-muted-foreground">
                  Loading statistics...
                </div>
              ) : adminStats ? (
                <div className="rounded-lg border">
                  <table className="w-full">
                    <tbody className="divide-y">
                      {/* Overview Stats */}
                      <tr>
                        <td className="p-3">Total Users</td>
                        <td className="p-3 text-right font-medium">
                          {adminStats.overview.totalUsers}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3">Total Cards</td>
                        <td className="p-3 text-right font-medium">
                          {adminStats.overview.totalCards}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3">Total Jobs</td>
                        <td className="p-3 text-right font-medium">
                          {adminStats.overview.totalJobs}
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3">Storage Used</td>
                        <td className="p-3 text-right font-medium">
                          {adminStats.overview.storageUsed}
                        </td>
                      </tr>

                      {/* Cards by Type */}
                      {Object.entries(adminStats.cards.byType).map(
                        ([type, count]) => (
                          <tr key={type}>
                            <td className="p-3 capitalize">{type} Cards</td>
                            <td className="p-3 text-right font-medium">
                              {count}
                            </td>
                          </tr>
                        )
                      )}

                      {/* Job Statistics */}
                      <tr>
                        <td className="p-3">Job Success Rate</td>
                        <td className="p-3 text-right font-medium">
                          {adminStats.jobs.successRate}%
                        </td>
                      </tr>
                      {Object.entries(adminStats.jobs.byStatus).map(
                        ([status, count]) => (
                          <tr key={status}>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <div
                                  className={cn(
                                    'size-2 rounded-full',
                                    status === 'completed' && 'bg-green-500',
                                    status === 'processing' && 'bg-blue-500',
                                    status === 'pending' && 'bg-yellow-500',
                                    status === 'failed' && 'bg-red-500'
                                  )}
                                />
                                <span className="capitalize">
                                  {status} Jobs
                                </span>
                              </div>
                            </td>
                            <td className="p-3 text-right font-medium">
                              {count}
                            </td>
                          </tr>
                        )
                      )}

                      {/* Top Users */}
                      {adminStats.cards.byUser.slice(0, 3).map((user) => (
                        <tr key={user.userId}>
                          <td className="p-3">
                            <div>
                              <div>{user.userName}</div>
                              <div className="text-muted-foreground text-xs">
                                {user.userEmail}
                              </div>
                            </div>
                          </td>
                          <td className="p-3 text-right font-medium">
                            {user.cardCount} cards
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center text-muted-foreground">
                  Failed to load statistics.
                </div>
              )}
            </div>
          </div>
        );
      case 'jobs':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="mb-4 font-medium text-lg">Jobs</h3>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    disabled={refetchOgImagesMutation.isPending}
                    onClick={() => refetchOgImagesMutation.mutate()}
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCw className="mr-2 size-4" />
                    {refetchOgImagesMutation.isPending
                      ? 'Starting...'
                      : 'Refetch OG Images'}
                  </Button>
                  <Button
                    disabled={refetchScreenshotsMutation.isPending}
                    onClick={() => refetchScreenshotsMutation.mutate()}
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCw className="mr-2 size-4" />
                    {refetchScreenshotsMutation.isPending
                      ? 'Starting...'
                      : 'Refetch Screenshots'}
                  </Button>
                </div>

{jobsLoading ? (
                  <div className="text-center text-muted-foreground">
                    Loading jobs...
                  </div>
                ) : jobs && jobs.length > 0 ? (
                  <div className="rounded-lg border">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="p-3 text-left font-medium">Job Type</th>
                          <th className="p-3 text-left font-medium">Status</th>
                          <th className="p-3 text-left font-medium">Created At</th>
                          <th className="p-3 text-left font-medium">Results</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {jobs.map((job) => (
                          <tr className="hover:bg-muted/20" key={job.id}>
                            <td className="p-3 font-medium">
                              {job.type === 'refetch-og-images' && 'Refetch OG Images'}
                              {job.type === 'refetch-screenshots' && 'Refetch Screenshots'}
                              {job.type === 'process-card' && 'Process Card'}
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <div
                                  className={cn(
                                    'size-2 rounded-full',
                                    job.status === 'completed' && 'bg-green-500',
                                    job.status === 'processing' && 'bg-blue-500',
                                    job.status === 'pending' && 'bg-yellow-500',
                                    job.status === 'failed' && 'bg-red-500'
                                  )}
                                />
                                <span className="capitalize">{job.status}</span>
                              </div>
                            </td>
                            <td className="p-3 text-muted-foreground">
                              {new Date(job.createdAt).toLocaleString()}
                            </td>
                            <td className="p-3">
                              {job.status === 'completed' &&
                                job.result &&
                                typeof job.result === 'object' &&
                                'processed' in job.result && (
                                  <span className="text-muted-foreground text-sm">
                                    {job.result.processed}/{job.result.total} items
                                  </span>
                                )}
                              {job.status === 'failed' && job.error && (
                                <span className="text-red-500 text-sm">
                                  {job.error}
                                </span>
                              )}
                              {(job.status === 'pending' || job.status === 'processing') && (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground">
                    No jobs found. Start a job using the buttons above.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog onOpenChange={setSettingsOpen} open={settingsOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost">
          <Settings className="size-4.5" />
          <span className="sr-only">Settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="h-[600px] p-0 md:max-w-3xl">
        <div className="flex h-full overflow-hidden">
          {/* Sidebar Navigation */}
          <div className="w-54 border-r bg-muted/30 p-4">
            <h2 className="mb-2 font-semibold">Settings</h2>

            <div className="space-y-6">
              {navigationGroups.map((group) => (
                <div key={group.title}>
                  <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    {group.title}
                  </h3>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeSection === item.id;

                      return (
                        <button
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                            isActive
                              ? 'bg-orange-100 font-medium text-orange-700'
                              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                          )}
                          key={item.id}
                          onClick={() => setActiveSection(item.id)}
                          type="button"
                        >
                          <Icon className="size-3.5 stroke-2" />
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            {renderSectionContent()}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
