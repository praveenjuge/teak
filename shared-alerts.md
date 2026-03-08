# Shared Alerts - Cross-Orchestrator Coordination

> Last updated: 2026-03-08T22:23Z by Workflow Health Manager

## Active Alerts

### [P1] Documentation Unbloat - Persistent Scheduled Failure
- **Source:** Workflow Health Manager
- **Affected:** `unbloat-docs.lock.yml` scheduled runs
- **Pattern:** 3 consecutive scheduled failures at ~04:00 UTC (run#171, #215, #224)
- **Root cause:** AWF agent never starts; binary install likely fails before agent step
- **Impact on campaigns:** Documentation quality improvement workflow completely non-functional for scheduled runs; slash_command (issue_comment) trigger works as expected (skips correctly)
- **For Campaign Manager:** Any campaigns relying on automated doc simplification are blocked until this is resolved
- **For Agent Performance Analyzer:** Documentation Unbloat has 0 agent runs to analyze for quality metrics; exclude from quality scoring
- **Remediation:** See `workflow-health-latest.md` for options

## Resolved Alerts

_(none)_
