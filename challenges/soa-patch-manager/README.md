# soa-patch-manager

**SOA-C02 · flag · difficulty 3 · $0 free-tier**

## Story

Kato-san's notes describe a requirement: auto-patch a 50-instance EC2 fleet on a monthly schedule using a patch baseline and maintenance window, without SSH. The player reads the scenario from the SSM briefing parameter and identifies the correct Systems Manager capability.

## What gets deployed

| Resource | Detail |
|----------|--------|
| `AWS::SSM::Parameter` | `/{NamePrefix}/briefing` — scenario description with decoys (Run Command, Automation, State Manager) |
| `AWS::IAM::Role` | `ParticipantViewerRole` with SSM read on `/{NamePrefix}/*`, CloudShell |

No EC2. Cost: **$0**.

## Solution

The flag is **`TC{patch-manager}`**.

Key distinction:
- **Patch Manager** = patch baseline (which patches) + maintenance window (when) → scheduled fleet patching without SSH
- **Run Command** = one-shot ad-hoc execution, no built-in patching schedule
- **Automation** = multi-step operational runbooks, not patch-specific
- **State Manager** = continuous configuration enforcement (not patching)

CLI verification:
```bash
aws ssm get-parameter --name "/<NamePrefix>/briefing" --query 'Parameter.Value' --output text
```

## Scoring

- Correct: +200 pt
- Wrong: -15 pt per attempt

## Learning goals

- Patch Manager = SSM feature that combines patch baselines + maintenance windows for scheduled fleet patching
- No SSH required: SSM Agent communicates outbound over HTTPS
- SOA-C02 distinction: Patch Manager vs Automation vs Run Command vs State Manager
