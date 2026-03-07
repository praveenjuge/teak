# Workflow Health Manager - Run: 2026-03-07T22:23Z
> Run ID: [§22808473545](https://github.com/praveenjuge/teak/actions/runs/22808473545)

## Overall Status
- Total agentic workflows: 9
- Compilation: 9/9 ✅ (all lock files present and up-to-date)
- Healthy (score ≥ 80): 7
- Warning (score 60-79): 1 (Documentation Unbloat - 1 scheduled failure on 2026-03-07)
- Inactive by design: 1 (Security Compliance - manual only)

## Workflow Health Scores
| Workflow | Score | Total Runs (7d) | Success Rate | Last Run |
|---|---|---|---|---|
| Daily Documentation Updater | 90 | 1 | 100% | 2026-03-07 06:18Z |
| Documentation Noob Tester | 90 | 2 | 100% | 2026-03-07 18:32Z |
| Duplicate Code Detector | 90 | 1 | 100% | 2026-03-07 10:49Z |
| Repository Quality Improver | 90 | 0 (weekend) | N/A | 2026-03-06 (Fri) |
| Update Docs | 90 | 2 | 100% | 2026-03-07 18:00Z |
| Workflow Health Manager | 90 | 1 | 100% | 2026-03-07 22:23Z |
| Code Simplifier | 85 | 1 | 100% | 2026-03-07 05:21Z |
| Security Compliance | 75 | 0 | N/A (manual) | Never |
| Documentation Unbloat | 65 | 1 scheduled (failure) | 0% scheduled | 2026-03-07 03:55Z |

## Key Findings (2026-03-07)
- Documentation Unbloat scheduled run #215 FAILED with infrastructure error
  - Agent job failed before executing; prompt file not found (/tmp/gh-aw/aw-prompts/prompt.txt absent)
  - Likely transient runner/inference startup error
  - All slash_command (issue_comment) runs: `skipped` as expected
  - First confirmed scheduled failure in this workflow's history
- All other scheduled workflows: 100% success
- Repository Quality Improver not running - weekend (expected)
- Code Simplifier: 2nd consecutive success, gaining confidence

## Issues Created
- Updated Workflow Health Dashboard (new issue for 2026-03-07)
- No new P0/P1 issues - ecosystem remains healthy

## Recommendations
- P2: Monitor Docs Unbloat scheduled runs; if failure recurs, investigate runner/inference availability
- P3: Repository Quality Improver will resume Monday - track next run
