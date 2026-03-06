# Workflow Health Manager - Run: 2026-03-06T22:24Z
> Run ID: [§22784426471](https://github.com/praveenjuge/teak/actions/runs/22784426471)

## Overall Status
- Total agentic workflows: 9
- Compilation: 9/9 ✅ (all lock files present and up-to-date)
- Healthy (score ≥ 80): 7
- Warning (score 60-79): 1 (Docs Unbloat - slash_command skips only visible)
- Inactive by design: 1 (Security Compliance - manual only)

## Workflow Health Scores
| Workflow | Score | Total Runs | Success Rate | Last Run |
|---|---|---|---|---|
| Daily Documentation Updater | 90 | 3 | 100% | 2026-03-06 06:25Z |
| Documentation Noob Tester | 90 | 2 | 100% | 2026-03-06 18:33Z |
| Duplicate Code Detector | 90 | 2 | 100% | 2026-03-06 10:56Z |
| Repository Quality Improver | 90 | 2 | 100% | 2026-03-06 13:28Z |
| Update Docs | 90 | 4 (7d) | 100% | 2026-03-06 16:56Z |
| Workflow Health Manager | 85 | 2 | 100% | 2026-03-06 22:23Z |
| Code Simplifier | 80 | 1 | 100% | 2026-03-06 05:26Z |
| Security Compliance | 75 | 0 | N/A (manual) | Never |
| Documentation Unbloat | 70 | 214 total | Skips visible | 2026-03-06 18:50Z |

## Key Observations
- No critical failures detected
- All lock files present and up-to-date - compilation 100%
- Documentation Unbloat: 214 total runs; 30 most recent are all slash_command (issue_comment) events that skip (expected). Scheduled runs not in recent 30; may be deeper in history or not yet triggered today.
- Security Compliance: Manual-only, requires audit_date input
- Code Simplifier: First run succeeded; monitor for stability
- Weekly trend: All scheduled workflows running cleanly, consistent 100% success rate

## Issues Created
- No P0/P1 issues - ecosystem is healthy
- Created Workflow Health Dashboard issue (new, updated from previous run)

## Recommendations
- P3: Investigate if Docs Unbloat scheduled runs are actually firing (not just slash_command events)
- P3: Monitor Code Simplifier for continued reliability as it accumulates more runs
