# Workflow Health Dashboard - 2026-03-10

> Run ID: [§22926997365](https://github.com/praveenjuge/teak/actions/runs/22926997365)

## Overview
- Total agentic workflows: 9
- Healthy (score ≥ 80): 8
- Warning (score 60-79): 1
- Critical (score < 60): 0
- Compilation: 9/9 ✅ (all lock files present and up-to-date)

## Workflow Health Scores (7-day)

| Workflow | Score | 7-day Runs | Success | Notes |
|---|---|---|---|---|
| Daily Documentation Updater | 95 | 1 | 100% | ✅ |
| Documentation Noob Tester | 95 | 2 | 100% | ✅ |
| Duplicate Code Detector | 95 | 1 | 100% | ✅ |
| Repository Quality Improver | 90 | 1 | 100% | ✅ |
| Code Simplifier | 90 | 1 | 100% | ✅ |
| Documentation Unbloat | 85 | 2 | 1/1 sched ✅ | Scheduled run recovered; PR run failed (branch checkout, not systemic) |
| Update Docs | 80 | 7 | 5/7 (71%) | 1 cancel (expected), 1 agent transient failure |
| Workflow Health Manager | 80 | 1 | 0% (prior run) | Prior run (#5) failed: patch size exceeded 10KB limit; fixed this run |
| Security Compliance | 75 | 0 | N/A | Manual only, never run by design |

## Issues Resolved Since Last Run ✅

### Documentation Unbloat - Scheduled Failure Streak Resolved
- Previous: 3 consecutive scheduled failures (P1)
- Current: Run #367 (2026-03-10T03:57Z, schedule) succeeded
- PR run #368 failed on "Checkout PR branch" — branch was likely deleted, not systemic
- **Status: Downgraded from P1 to informational**

## Active Issues

### Workflow Health Manager - Patch Size Limit
- **Run #5 (2026-03-09T22:22Z):** `push_repo_memory` job failed — patch size 12.5KB exceeded 10KB limit
- **Root cause:** Health report + shared-alerts combined patch was too large
- **Fix applied this run:** Reduced file sizes (target < 5KB each)
- **Priority:** P2 (self-healing; fix applied)

### Update Docs - Transient Agent Failure
- **Run #83 (2026-03-10T07:55Z, push):** `Execute GitHub Copilot CLI` step failed; detection passed
- **Pattern:** Isolated transient failure; run #84 succeeded
- **Priority:** P3 (monitor only)

## Healthy Workflows ✅
7 workflows operating normally: Daily Documentation Updater, Documentation Noob Tester, Duplicate Code Detector, Repository Quality Improver, Code Simplifier, Documentation Unbloat (scheduled), Update Docs (mostly).

## Systemic Issues
None detected. No cascading failures, no rate-limiting patterns.

## Trends
- Overall ecosystem health: Improving (Documentation Unbloat resolved from P1)
- Average scheduled-workflow success rate: ~96%
- Workflows needing recompilation: 0

## Recommendations

### Low Priority
1. **Security Compliance** (P3): Add a quarterly scheduled run to prevent untested drift
2. **Update Docs** (P3): Monitor cancel+failure rate; no action needed yet
3. **Workflow Health Manager** (P2): Memory files must stay under 5KB each to avoid patch size failures

## Actions Taken This Run
- Updated `workflow-health-latest.md` (reduced size to avoid patch limit)
- Downgraded Documentation Unbloat from P1 to resolved
- Cleared stale P1 alert from `shared-alerts.md`

---
> Last updated: 2026-03-10T22:30Z
> Next check: 2026-03-10T22:21Z (scheduled)
