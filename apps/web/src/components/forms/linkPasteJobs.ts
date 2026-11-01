"use client";

import type { Id } from "@teak/convex/_generated/dataModel";
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";

export interface PasteJob {
  extraOmitted: number;
  jobId: Id<"linkPasteJobs">;
  toastId: string | number;
}

/**
 * Pasted lists still saving, kept outside the composer: the first cards in an
 * empty library swap the empty state's composer for the grid's, and the new
 * one has to pick up the job and its toast.
 */
let jobs: readonly PasteJob[] = [];
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const addLinkPasteJob = (job: PasteJob) => {
  jobs = [...jobs.filter((current) => current.jobId !== job.jobId), job];
  emit();
};

export const finishLinkPasteJob = (jobId: Id<"linkPasteJobs">) => {
  if (!jobs.some((job) => job.jobId === jobId)) {
    return;
  }
  jobs = jobs.filter((job) => job.jobId !== jobId);
  emit();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const trackers = new Map<Id<"linkPasteJobs">, number>();

/**
 * Marks a job's toast as shown by the calling component. When the last one
 * goes away mid-job (a page with no composer), the toast is dismissed so no
 * spinner is left behind. The check waits a tick: a composer that replaces
 * another, or React's double effect in development, takes the toast over
 * instead. Dismissing and then reusing the same toast id makes Sonner remove
 * the next message it shows under that id.
 */
export const useLinkPasteToastOwner = (job: PasteJob) => {
  const { jobId, toastId } = job;
  useEffect(() => {
    trackers.set(jobId, (trackers.get(jobId) ?? 0) + 1);
    return () => {
      trackers.set(jobId, (trackers.get(jobId) ?? 1) - 1);
      setTimeout(() => {
        if ((trackers.get(jobId) ?? 0) > 0) {
          return;
        }
        trackers.delete(jobId);
        if (jobs.some((current) => current.jobId === jobId)) {
          toast.dismiss(toastId);
        }
      }, 0);
    };
  }, [jobId, toastId]);
};

const getSnapshot = () => jobs;
// One array, so the server snapshot is the same value on every read.
const NO_JOBS: readonly PasteJob[] = [];
const getServerSnapshot = () => NO_JOBS;

export const useLinkPasteJobs = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
