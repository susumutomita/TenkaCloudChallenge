# dva-stepfunctions-task-count · DVA · flag · difficulty 3 · $0

## Story

Kato-san left a Step Functions workflow and nobody knows how many Task states
it contains. The new SRE (you) must read the state machine definition and count
only the Task states (not Pass, Choice, or Wait).

## What gets deployed

| Resource | Notes |
|---|---|
| `AWS::StepFunctions::StateMachine` | `${NamePrefix}-workflow`, STANDARD type, 3 Task + 1 Choice + 1 Wait + 1 Pass |
| `AWS::IAM::Role` (sfn exec) | Minimal: CloudWatch Logs only |
| `AWS::IAM::Role` (viewer) | ParticipantViewerRole with `states:DescribeStateMachine` + `states:ListStateMachines` |
| `AWS::SSM::Parameter` | `/${NamePrefix}/briefing` |

## State machine structure

```
StartAt: ValidateInput (Task 1/3)
  -> IsValid? (Choice -- NOT a Task)
     true  -> WaitForReady (Wait -- NOT a Task)
                -> ProcessItem (Task 2/3)
                   -> Notify (Task 3/3) -> End
     false -> RejectInput (Pass -- NOT a Task) -> End
```

Task states: `ValidateInput`, `ProcessItem`, `Notify` = **3**

## Solution

```bash
SM_ARN=$(aws stepfunctions list-state-machines \
  --query "stateMachines[?starts_with(name,'<NamePrefix>')].stateMachineArn" \
  --output text)

aws stepfunctions describe-state-machine \
  --state-machine-arn "$SM_ARN" \
  --query 'definition' \
  --output text | jq 'fromjson | .States | to_entries | map(select(.value.Type == "Task")) | length'
```

**Flag:** `TC{3-task-states}`

## Scoring

- Correct: +200 pt
- Wrong: -20 pt each (anti-brute-force)
- Hint 1: -25 pt (jq command to count Task states)
- Hint 2: -50 pt (reveals 3-task-states)

## Learning goals

- Step Functions state types: Task (calls services), Pass (transform), Choice (branch), Wait (delay)
- Only Task states count as service integrations
- `aws stepfunctions describe-state-machine` returns the definition JSON for analysis
