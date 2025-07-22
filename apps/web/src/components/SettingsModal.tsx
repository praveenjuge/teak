import {
  useAdminStats,
  useAiSettings,
  useJobs,
  useRefetchOgImages,
  useRefetchScreenshots,
  useRefreshAiData,
  useUpdateAiSettings,
  useUsers,
} from '@teak/shared-queries';
import type { Job, JobType } from '@teak/shared-types';
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
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

type JobFilter = 'all' | 'user-initiated' | 'ai-processing';

// Helper function to get friendly job type names
const getJobTypeName = (type: JobType): string => {
  switch (type) {
    case 'refetch-og-images':
      return 'Refetch OG Images';
    case 'refetch-screenshots':
      return 'Refetch Screenshots';
    case 'refresh-ai-data':
      return 'Refresh AI Data';
    case 'process-card':
      return 'Process Card';
    case 'ai-enrich-text':
      return 'AI Enrich Text';
    case 'ai-enrich-image':
      return 'AI Enrich Image';
    case 'ai-enrich-pdf':
      return 'AI Enrich PDF';
    case 'ai-enrich-audio':
      return 'AI Enrich Audio';
    case 'ai-enrich-url':
      return 'AI Enrich URL';
    default:
      return type;
  }
};

// Helper function to categorize job types
const getJobCategory = (type: JobType): JobFilter => {
  const userInitiatedTypes: JobType[] = [
    'refetch-og-images',
    'refetch-screenshots',
    'refresh-ai-data',
  ];
  const aiProcessingTypes: JobType[] = [
    'ai-enrich-text',
    'ai-enrich-image',
    'ai-enrich-pdf',
    'ai-enrich-audio',
    'ai-enrich-url',
  ];

  if (userInitiatedTypes.includes(type)) {
    return 'user-initiated';
  }
  if (aiProcessingTypes.includes(type)) {
    return 'ai-processing';
  }
  return 'all';
};

// Helper function to filter jobs
const filterJobs = (jobs: Job[], filter: JobFilter): Job[] => {
  if (filter === 'all') return jobs;
  return jobs.filter((job) => getJobCategory(job.type) === filter);
};

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
  const [jobFilter, setJobFilter] = useState<JobFilter>('user-initiated');

  // Job-related hooks
  const { data: jobs, isLoading: jobsLoading } = useJobs(apiClient);
  const refetchOgImagesMutation = useRefetchOgImages(apiClient);
  const refetchScreenshotsMutation = useRefetchScreenshots(apiClient);
  const refreshAiDataMutation = useRefreshAiData(apiClient);

  // Admin hooks
  const { data: adminStats, isLoading: adminStatsLoading } =
    useAdminStats(apiClient);
  const { data: users, isLoading: usersLoading } = useUsers(apiClient);

  // AI Settings hooks
  const { data: aiSettings, isLoading: aiSettingsLoading } =
    useAiSettings(apiClient);
  const updateAiSettingsMutation = useUpdateAiSettings(apiClient);
  const [aiFormData, setAiFormData] = useState({
    openaiBaseUrl: '',
    openaiApiKey: '',
    aiTextModelName: '',
    aiImageTextModelName: '',
    embeddingModelName: '',
    audioTranscriptModelName: '',
    fileTranscriptModelName: '',
  });

  // Sync form data with loaded AI settings
  useEffect(() => {
    if (aiSettings) {
      setAiFormData({
        openaiBaseUrl: aiSettings.openaiBaseUrl || '',
        openaiApiKey: aiSettings.openaiApiKey || '',
        aiTextModelName: aiSettings.aiTextModelName || '',
        aiImageTextModelName: aiSettings.aiImageTextModelName || '',
        embeddingModelName: aiSettings.embeddingModelName || '',
        audioTranscriptModelName: aiSettings.audioTranscriptModelName || '',
        fileTranscriptModelName: aiSettings.fileTranscriptModelName || '',
      });
    }
  }, [aiSettings]);

  const handleAiSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateAiSettingsMutation.mutateAsync(aiFormData);
    } catch (error) {
      console.error('Failed to update AI settings:', error);
    }
  };

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

              {aiSettingsLoading ? (
                <div className="text-center text-muted-foreground">
                  Loading AI settings...
                </div>
              ) : (
                <form className="space-y-4" onSubmit={handleAiSettingsSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="openaiBaseUrl">OpenAI Base URL</Label>
                    <Input
                      id="openaiBaseUrl"
                      onChange={(e) =>
                        setAiFormData({
                          ...aiFormData,
                          openaiBaseUrl: e.target.value,
                        })
                      }
                      placeholder="https://api.openai.com/v1"
                      type="url"
                      value={aiFormData.openaiBaseUrl}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="openaiApiKey">OpenAI API Key</Label>
                    <Input
                      id="openaiApiKey"
                      onChange={(e) =>
                        setAiFormData({
                          ...aiFormData,
                          openaiApiKey: e.target.value,
                        })
                      }
                      placeholder="sk-..."
                      type="password"
                      value={aiFormData.openaiApiKey}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="aiTextModelName">Text Model Name</Label>
                    <Input
                      id="aiTextModelName"
                      onChange={(e) =>
                        setAiFormData({
                          ...aiFormData,
                          aiTextModelName: e.target.value,
                        })
                      }
                      placeholder="gpt-4o"
                      value={aiFormData.aiTextModelName}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="aiImageTextModelName">
                      Image Text Model Name
                    </Label>
                    <Input
                      id="aiImageTextModelName"
                      onChange={(e) =>
                        setAiFormData({
                          ...aiFormData,
                          aiImageTextModelName: e.target.value,
                        })
                      }
                      placeholder="gpt-4o"
                      value={aiFormData.aiImageTextModelName}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="embeddingModelName">
                      Embedding Model Name
                    </Label>
                    <Input
                      id="embeddingModelName"
                      onChange={(e) =>
                        setAiFormData({
                          ...aiFormData,
                          embeddingModelName: e.target.value,
                        })
                      }
                      placeholder="text-embedding-3-small"
                      value={aiFormData.embeddingModelName}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="audioTranscriptModelName">
                      Audio Transcript Model Name
                    </Label>
                    <Input
                      id="audioTranscriptModelName"
                      onChange={(e) =>
                        setAiFormData({
                          ...aiFormData,
                          audioTranscriptModelName: e.target.value,
                        })
                      }
                      placeholder="whisper-1"
                      value={aiFormData.audioTranscriptModelName}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fileTranscriptModelName">
                      File Transcript Model Name
                    </Label>
                    <Input
                      id="fileTranscriptModelName"
                      onChange={(e) =>
                        setAiFormData({
                          ...aiFormData,
                          fileTranscriptModelName: e.target.value,
                        })
                      }
                      placeholder="gpt-4o"
                      value={aiFormData.fileTranscriptModelName}
                    />
                  </div>

                  <Button
                    disabled={updateAiSettingsMutation.isPending}
                    type="submit"
                  >
                    {updateAiSettingsMutation.isPending
                      ? 'Saving...'
                      : 'Save Settings'}
                  </Button>
                </form>
              )}
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
              <h3 className="mb-4 font-medium text-lg">Users</h3>

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
              <h3 className="mb-4 font-medium text-lg">Statistics</h3>

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
                {/* Job Filter Buttons */}
                <div className="flex gap-2 border-b pb-3">
                  <Button
                    onClick={() => setJobFilter('user-initiated')}
                    size="sm"
                    variant={
                      jobFilter === 'user-initiated' ? 'default' : 'outline'
                    }
                  >
                    My Jobs
                  </Button>
                  <Button
                    onClick={() => setJobFilter('ai-processing')}
                    size="sm"
                    variant={
                      jobFilter === 'ai-processing' ? 'default' : 'outline'
                    }
                  >
                    AI Processing
                  </Button>
                  <Button
                    onClick={() => setJobFilter('all')}
                    size="sm"
                    variant={jobFilter === 'all' ? 'default' : 'outline'}
                  >
                    All Jobs
                  </Button>
                </div>
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
                  <Button
                    disabled={refreshAiDataMutation.isPending}
                    onClick={() => refreshAiDataMutation.mutate()}
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCw className="mr-2 size-4" />
                    {refreshAiDataMutation.isPending
                      ? 'Starting...'
                      : 'Refresh AI Data'}
                  </Button>
                </div>

                {jobsLoading ? (
                  <div className="text-center text-muted-foreground">
                    Loading jobs...
                  </div>
                ) : jobs && jobs.length > 0 ? (
                  (() => {
                    const filteredJobs = filterJobs(jobs, jobFilter);
                    return filteredJobs.length > 0 ? (
                      <div className="rounded-lg border">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b bg-muted/30">
                              <th className="p-3 text-left font-medium">
                                Job Type
                              </th>
                              <th className="p-3 text-left font-medium">
                                Status
                              </th>
                              <th className="p-3 text-left font-medium">
                                Created At
                              </th>
                              <th className="p-3 text-left font-medium">
                                Results
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {filteredJobs.map((job) => (
                              <tr className="hover:bg-muted/20" key={job.id}>
                                <td className="p-3">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className={cn(
                                        'size-2 rounded-full',
                                        getJobCategory(job.type) ===
                                          'user-initiated' && 'bg-blue-500',
                                        getJobCategory(job.type) ===
                                          'ai-processing' && 'bg-purple-500',
                                        getJobCategory(job.type) === 'all' &&
                                          'bg-gray-500'
                                      )}
                                    />
                                    <span className="font-medium">
                                      {getJobTypeName(job.type)}
                                    </span>
                                  </div>
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className={cn(
                                        'size-2 rounded-full',
                                        job.status === 'completed' &&
                                          'bg-green-500',
                                        job.status === 'processing' &&
                                          'bg-blue-500',
                                        job.status === 'pending' &&
                                          'bg-yellow-500',
                                        job.status === 'failed' && 'bg-red-500'
                                      )}
                                    />
                                    <span className="capitalize">
                                      {job.status}
                                    </span>
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
                                      <span className="text-muted-foreground">
                                        {job.result.processed}/
                                        {job.result.total} items
                                      </span>
                                    )}
                                  {job.status === 'failed' && job.error && (
                                    <span className="text-red-500">
                                      {job.error}
                                    </span>
                                  )}
                                  {(job.status === 'pending' ||
                                    job.status === 'processing') && (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center text-muted-foreground">
                        No{' '}
                        {jobFilter === 'all' ? '' : jobFilter.replace('-', ' ')}{' '}
                        jobs found.
                        {jobFilter === 'user-initiated' &&
                          ' Start a job using the buttons above.'}
                      </div>
                    );
                  })()
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
      <DialogContent
        className="flex h-[600px] overflow-hidden border-0 bg-muted p-4 md:max-w-4xl"
        showCloseButton={false}
      >
        {/* Sidebar Navigation */}
        <div className="w-40">
          <DialogClose asChild>
            <Button size="icon" type="button" variant="ghost">
              <X className="size-4" />
            </Button>
          </DialogClose>

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
                      <Button
                        className="w-full justify-start"
                        key={item.id}
                        onClick={() => setActiveSection(item.id)}
                        size="sm"
                        variant={isActive ? 'outline' : 'ghost'}
                      >
                        <Icon className="size-3.5 stroke-2" />
                        {item.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto rounded-lg border bg-background p-4">
          {renderSectionContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
