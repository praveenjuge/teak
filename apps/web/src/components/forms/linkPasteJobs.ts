"use client";

import type { Id } from "@teak/convex/_generated/dataModel";
import { useSyncExternalStore } from "react";

export interface PasteJob {
  /** Lines the composer never sent, past the most one paste may send. */
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

const getSnapshot = () => jobs;
const getServerSnapshot = (): readonly PasteJob[] => [];

export const useLinkPasteJobs = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
