# Workflow Health Dashboard - 2026-03-08

> Run ID: [§22831218063](https://github.com/praveenjuge/teak/actions/runs/22831218063)

## Overview
- Total agentic workflows: 9
- Healthy (score ≥ 80): 7
- Warning (score 60-79): 1
- Critical (score < 60): 0
- Inactive (no scheduled runs): 1 (Security Compliance - manual only by design)
- Compilation: 9/9 ✅ (all lock files present and up-to-date)

## Workflow Health Scores

| Workflow | Score | Scheduled Runs (all-time) | Success Rate | Last Scheduled Run |
|---|---|---|---|---|
| Daily Documentation Updater | 95 | 5 | 100% | 2026-03-08T06:22Z ✅ |
| Documentation Noob Tester | 95 | 4 | 100% | 2026-03-08T18:32Z ✅ |
| Duplicate Code Detector | 95 | 4 | 100% | 2026-03-08T10:50Z ✅ |
| Repository Quality Improver | 90 | 2 | 100% | 2026-03-06T13:28Z ✅ |
| Code Simplifier | 90 | 3 | 100% | 2026-03-08T05:25Z ✅ |
| Workflow Health Manager | 90 | 3 (+ current) | 100% | 2026-03-08T22:21Z ✅ |
| Update Docs | 85 | 58 (push) | 100% success / ~14% cancel | 2026-03-08T18:48Z ✅ |
| Security Compliance | 75 | 0 | N/A (manual only) | Never |
| Documentation Unbloat | 55 | 3 | 0% (3/3 failed) | 2026-03-08T03:58Z ❌ |

## Critical Issues 🚨

### Documentation Unbloat (Score: 55/100)
- **Status:** 100% scheduled run failure — 3 consecutive failures (run#171, #215, #224)
- **Error:** AWF agent never starts; no log files found in `/tmp/gh-aw/sandbox/agent/logs/`; prompt file `/tmp/gh-aw/aw-prompts/prompt.txt` never written
- **Pattern:** All failures happen at ~04:00 UTC; each run completes in < 1 second (agent never executes)
- **Root cause hypothesis:** AWF binary install or container startup fails at this time; message "it may not be installed if workflow failed before install step" seen in cleanup logs
- **Note:** 314/317 runs are `issue_comment` events that correctly `skip` (slash_command guard works); only `schedule` events fail
- **Action:** This workflow is the only one with explicit `sandbox: agent: awf` in source (others use it implicitly). Investigate whether removing the explicit `sandbox:` block from `unbloat-docs.md` and recompiling resolves the issue (test via workflow_dispatch first). Also consider shifting the schedule time away from 04:00 UTC.
- **Priority:** P1

## Warnings ⚠️

### Update Docs (Score: 85 — informational)
- **Issue:** 8 out of 30 recent runs cancelled (~27%)
- **Assessment:** Cancellations are expected when multiple pushes supersede each other; not a reliability concern
- **Recommendation:** No action needed; monitor if cancel rate increases significantly

### Security Compliance (Score: 75 — informational)
- **Issue:** Never run; manual-only workflow
- **Assessment:** By design — workflow is triggered only via `workflow_dispatch`
- **Recommendation:** Consider adding a quarterly scheduled run to ensure it stays functional

## Healthy Workflows ✅

7 workflows operating normally:
- Daily Documentation Updater: 5/5 scheduled runs (100%)
- Documentation Noob Tester: 4/4 scheduled runs (100%)
- Duplicate Code Detector: 4/4 scheduled runs (100%)
- Repository Quality Improver: 2/2 scheduled runs (100%)
- Code Simplifier: 3/3 scheduled runs (100%)
- Workflow Health Manager: 3/3 scheduled runs (100%, current in-progress)
- Update Docs: 58 push-triggered runs, all successful (cancels expected)

## Systemic Issues

### None detected.
All healthy workflows are on consistent schedules with no conflicts. No rate-limiting patterns. No cascading failures.

## Trends

- Overall ecosystem health: Strong; 7/9 workflows fully healthy
- Documentation Unbloat failure: 3rd consecutive day failing; escalating from "warning" (last run) to P1
- No new systemic issues emerged since 2026-03-07 report
- Average success rate across scheduled workflows (excluding Unbloat): 100%
- Workflows needing recompilation: 0

## Recommendations

### High Priority
1. **Fix Documentation Unbloat** (P1): Investigate AWF sandbox issue at 04:00 UTC:
   - Option A: Remove explicit `sandbox: agent: awf` from `unbloat-docs.md` and recompile (test via workflow_dispatch first)
   - Option B: Shift schedule time from `daily` (04:00 UTC) to a different time (e.g., 10:00 UTC) to avoid potential runner contention
   - Check GitHub Status for runner availability at 04:00 UTC

### Low Priority
2. **Security Compliance** (P3): Add a quarterly scheduled run to prevent drift into inactive/untested state
3. **Update Docs** (P3): No action needed; cancellation rate is expected

## Actions Taken This Run

- Updated `workflow-health-latest.md` with current findings
- Documentation Unbloat escalated from Warning to P1 (3rd consecutive failure)
- No GitHub issues created (health tracking kept in repo memory per policy)

---
> Last updated: 2026-03-08T22:23Z
> Next check: 2026-03-09T22:21Z
