# dop-ssm-automation

**DOP-C02 · flag · difficulty 3 · $0**

## Story

Kato-san's EC2 patching was entirely manual SSH with no documented procedure.
CTO Sasaki-san wants a multi-step patch-apply, verify, reboot runbook codified as
a repeatable, auditable document that does not require SSH.
The learner identifies the correct Systems Manager capability.

## What gets deployed

- SSM Parameter `/{NamePrefix}/briefing` (scenario question with decoy options)

Cost: $0.

## Solution

The flag is `TC{automation}`.

AWS Systems Manager Automation lets you define multi-step operational runbooks as
Automation Documents (SSM Documents of type Automation) and execute them on demand,
on a schedule, or via EventBridge events. Decoys:
- **Run Command**: broadcasts a single command to a fleet (not multi-step)
- **Patch Manager**: manages patch baselines + maintenance windows (patch-specific, not general runbooks)

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

1. Clearly explain role differences among SSM Automation, Run Command, and Patch Manager
2. Understand SSM Automation document design patterns and step types
3. Internalize the DOP principle of managing repeatable, auditable operations as IaC
