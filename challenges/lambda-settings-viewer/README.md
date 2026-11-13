# The support desk's settings viewer

> 日本語: [README.ja.md](./README.ja.md)

A beginner Challenge about a Lambda function's execution role and its input. The participant
calls a small support-desk function, notices that it reads Parameter Store with its own role,
and pulls out an internal value they cannot read themselves. Then, without scoring, they fix
the code, redeploy it and watch the same call stop working.

Trying "what if I deploy code with a hole in it" is uncomfortable on a real cloud account.
On the local TenkaCloud Simulator the same template runs with no cloud account and no bill, so
participants can break and redeploy the function as often as they like.

| Item | Value |
| --- | --- |
| Category | Challenge |
| Difficulty | 2 / 5 (beginner) |
| Estimated time | 20–30 minutes |
| Status | `draft` |
| Scoring | `flag` (`points`: 100, `wrongAnswerPenalty`: 5) |

## Story

Tenka Cloud's support desk uses a small Lambda function, the "settings viewer", to look up
settings it may share with customers, such as support hours. You have just inherited it, and the next release is
planned to add an internal notification feature to the same function. Security asks one
thing: run it and tell us whether it is safe to hand this function to the support desk.

## What the template deploys

| Resource | Purpose |
| --- | --- |
| `AWS::Lambda::Function` `SettingsViewerFunction` | Python 3.12, 128 MB, 10 s timeout. Returns a setting by name. CloudFormation generates the name (within 64 characters for every team name) and the `FunctionName` output shows it. |
| `AWS::IAM::Role` `SettingsViewerRole` | The function's execution role. Reads `/{NamePrefix}/*`. |
| `AWS::SSM::Parameter` × 2 | Public settings under `/{NamePrefix}/public/`. |
| `AWS::SSM::Parameter` `/{NamePrefix}/internal/release-token` | The flag, `TC{…}` with a per-deploy random value. |
| `AWS::IAM::Role` `ParticipantViewerRole` | The participant's role (below). |

No EC2, VPC, NAT, load balancer or public endpoint is created.

### The participant's permissions

- `ssm:GetParameter` / `GetParameters` on `/{NamePrefix}/public/*` only.
- `lambda:InvokeFunction`, `GetFunctionConfiguration`, `GetFunction` and `UpdateFunctionCode` on
  this one function, by ARN.
- The catalog's sign-in and CloudShell baseline, as in every problem.

There are no list-style grants such as `lambda:ListFunctions` or `ssm:DescribeParameters`: on a
shared local Simulator a list would show other teams' names. Participants name the function with
the `FunctionName` output. They cannot read the internal parameter, change any IAM policy, or
create other functions.

## The function's code

```python
import os

import boto3

ssm = boto3.client("ssm")
SETTINGS_PREFIX = os.environ["SETTINGS_PREFIX"]


def handler(event, context):
    # Support desk: {"name": "support-hours"} returns that public setting.
    # A full name such as "/team/public/greeting" is accepted as well.
    name = str(event.get("name", "greeting"))
    if not name.startswith("/"):
        name = SETTINGS_PREFIX + name
    try:
        value = ssm.get_parameter(Name=name)["Parameter"]["Value"]
    except Exception as error:
        code = getattr(error, "response", {}).get("Error", {}).get("Code", type(error).__name__)
        return {"ok": False, "name": name, "error": code}
    return {"ok": True, "name": name, "value": value}

# TODO(release-notifier): the next release posts RELEASE_TOKEN_PARAM's value
# to the deploy channel from this same function.
```

To redeploy, save it as `index.py`, zip that one file at the archive root, and run
`aws lambda update-function-code --function-name <function> --zip-file fileb://function.zip`
(on AWS, uploading the ZIP from the function's Code tab works too).
The handler stays `index.handler`.

## Participant route

1. Invoke the function with `{"name": "support-hours"}`. The response includes the full name
   it read, `/{NamePrefix}/public/support-hours`.
2. Read the configuration. The environment variable `RELEASE_TOKEN_PARAM` names
   `/{NamePrefix}/internal/release-token`. Reading it directly with `aws ssm get-parameter`
   fails with AccessDenied.
3. Invoke with `{"name": "/{NamePrefix}/internal/release-token"}`. The function reads it with
   its own role and returns `TC{…}`. Submit it.

Another route reaches the same value: redeploy code that reads `RELEASE_TOKEN_PARAM` directly.
Whoever can update a function's code can use its role. Both routes teach the same point.

### One step further (not scored)

The instructions' "one step further" gives a starting point that always builds the shelf name
under `SETTINGS_PREFIX` and asks the participant to add the check. Even unchanged, it makes the
call that returned the flag fail. A fix for organizers to show:

```python
    name = str(event.get("name", "greeting"))
    if "/" in name:
        return {"ok": False, "name": name, "error": "OnlyPublicSettingNames"}
    name = SETTINGS_PREFIX + name
```

After redeploying, `{"name": "support-hours"}` still works and the full-name call returns
`OnlyPublicSettingNames`. The complete fix also narrows the execution role to
`/{NamePrefix}/public/*`, which needs IAM permissions the participant does not have. Organizers
can show it in the debrief.

## Scoring evidence

| Event | Points |
| --- | --- |
| Submitted value equals the `ReleaseTokenValue` output | +100 |
| Wrong answer | −5 |

Hints: 10 / 15 / 25 points (50 % of 100 in total), from the mechanism, to a small example, to
the steps on the participant's own values.

## Safety boundary

- The flag is random per deploy and stored only in the internal parameter and a stack output
  that participants cannot read.
- The participant role is scoped to this stack's one function and its public parameters. In
  TenkaCloud's local Simulator mode all teams share one Simulator, but no team reaches another
  team's function or parameters.
- SDK calls inside the function are evaluated with the function's execution role only. They
  never inherit the caller's session permissions.
- The function has no network access beyond the AWS APIs its role allows. It does not reach the
  internet on the Simulator, and on AWS it has no VPC and no inbound endpoint.

## Cost-bearing resources and teardown

On AWS (any region with Python 3.12 Lambda; the event's default is the organizer's choice):
one Lambda function, two IAM roles and three SSM Standard parameters. Standard parameters are
free, and a session of invocations stays within Lambda's free tier for typical accounts.
Deleting the stack removes everything; nothing is retained.

On the local Simulator, nothing is billed.

## Running on the local Simulator

Checked on a TenkaCloudSimulator build that lets participant sessions use Lambda (its
`nativeSdk.services` capability includes `lambda`): the template was deployed directly and the participant role was
assumed with its ExternalId. With a 40-character team name, the maximum, the stack reaches
`CREATE_COMPLETE` and the generated function name fits in 64 characters.

- `{"name": "support-hours"}` returns the support hours.
- `get-function-configuration` shows `RELEASE_TOKEN_PARAM` and `SETTINGS_PREFIX`.
- Reading the `RELEASE_TOKEN_PARAM` name directly with `ssm get-parameter` returns
  `AccessDeniedException`.
- Invoking the function with that name returns `TC{…}` through the execution role.
- Redeploying code that reads `RELEASE_TOKEN_PARAM` directly returns the same value as the
  `ReleaseTokenValue` output.
- Redeploying the fix above, or the instructions' starting point, makes the same call fail
  while `support-hours` and the default call keep working.
- Invoking another team's function, `ListFunctions` and `CreateFunction` return
  `AccessDeniedException`.

Playing it through TenkaCloud on the Simulator needs platform support beyond the template. The
Simulator has no Lambda console entry, so participants use the CLI credentials on the problem
page.

## Local verification

```sh
make install
make agent-gate
```

## Files

- [`metadata.json`](./metadata.json) — problem metadata
- [`template.yaml`](./template.yaml) — CloudFormation template
- [`simulation.json`](./simulation.json) — Simulator capabilities the problem needs
