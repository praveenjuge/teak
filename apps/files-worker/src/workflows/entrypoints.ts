import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { runAccountDeletion } from "./accountDeletion";
import { runCardProcessing } from "./cardProcessing/run";
import { runExport } from "./export";
import { runImport } from "./import";
import { runMaintenance } from "./maintenance";
import type { BackgroundEnv, Steps, WorkflowRun } from "./runtime";

const toRun = <Params>(
  env: BackgroundEnv,
  event: Readonly<WorkflowEvent<Params>>,
  step: WorkflowStep
): WorkflowRun<Params> => ({
  env,
  instanceId: event.instanceId,
  params: event.payload as WorkflowRun<Params>["params"],
  step: step as unknown as Steps,
});

export class CardProcessingWorkflow extends WorkflowEntrypoint<BackgroundEnv> {
  run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    return runCardProcessing(toRun(this.env, event as never, step));
  }
}

export class ExportWorkflow extends WorkflowEntrypoint<BackgroundEnv> {
  run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    return runExport(toRun(this.env, event as never, step));
  }
}

export class ImportWorkflow extends WorkflowEntrypoint<BackgroundEnv> {
  run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    return runImport(toRun(this.env, event as never, step));
  }
}

export class AccountDeletionWorkflow extends WorkflowEntrypoint<BackgroundEnv> {
  run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    return runAccountDeletion(toRun(this.env, event as never, step));
  }
}

export class MaintenanceWorkflow extends WorkflowEntrypoint<BackgroundEnv> {
  run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    return runMaintenance(toRun(this.env, event as never, step));
  }
}
