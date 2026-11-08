import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/**
 * #951: a participant may only create / widen execution roles that carry the
 * stack's permissions boundary, and the boundary itself must never grant iam:*.
 * This reads template.yaml as CloudFormation (short-form intrinsics included) and
 * checks the IAM contract statically. It does not prove IAM evaluation on a real
 * account; that stays an event rehearsal.
 */

const templatePath = fileURLToPath(new URL("./template.yaml", import.meta.url));

// CloudFormation short-form intrinsic tags, mapped to their long-form objects so
// the parsed template can be walked like the JSON CloudFormation produces.
const scalarTag = (tag, key) => ({ tag, resolve: (value) => ({ [key]: value }) });
const seqTag = (tag, key) => ({ tag, collection: "seq", resolve: (seq) => ({ [key]: seq.toJSON() }) });
const customTags = [
  scalarTag("!Ref", "Ref"),
  scalarTag("!Sub", "Fn::Sub"),
  seqTag("!Sub", "Fn::Sub"),
  scalarTag("!GetAtt", "Fn::GetAtt"),
  seqTag("!GetAtt", "Fn::GetAtt"),
  scalarTag("!GetAZs", "Fn::GetAZs"),
  seqTag("!Select", "Fn::Select"),
  seqTag("!Join", "Fn::Join"),
  seqTag("!If", "Fn::If"),
  seqTag("!Equals", "Fn::Equals"),
  seqTag("!Not", "Fn::Not"),
  seqTag("!And", "Fn::And"),
  seqTag("!Or", "Fn::Or"),
  seqTag("!FindInMap", "Fn::FindInMap"),
  scalarTag("!Condition", "Condition"),
  scalarTag("!ImportValue", "Fn::ImportValue"),
  scalarTag("!Base64", "Fn::Base64"),
];

const template = parse(readFileSync(templatePath, "utf8"), { customTags });
const resources = template.Resources;

const BOUNDARY_LOGICAL_ID = "ExecutionRoleBoundary";
const BOUNDARY_REF = { Ref: BOUNDARY_LOGICAL_ID };
const ROLE_WIDENING_ACTIONS = ["iam:CreateRole", "iam:PutRolePolicy", "iam:AttachRolePolicy"];
const NEVER_GRANTED = ["iam:PutRolePermissionsBoundary", "iam:DeleteRolePermissionsBoundary"];

const asList = (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/** Every statement of the participant role's inline policies plus its Sid. */
function participantStatements() {
  const role = resources.ParticipantViewerRole;
  assert.equal(role?.Type, "AWS::IAM::Role");
  return role.Properties.Policies.flatMap((policy) => policy.PolicyDocument.Statement);
}

function boundaryStatements() {
  const boundary = resources[BOUNDARY_LOGICAL_ID];
  assert.equal(boundary?.Type, "AWS::IAM::ManagedPolicy", `${BOUNDARY_LOGICAL_ID} must be an AWS::IAM::ManagedPolicy`);
  return boundary.Properties.PolicyDocument.Statement;
}

test("the boundary policy exists, is named per team, and carries the three allowed managed policies' permissions without iam:*", () => {
  const boundary = resources[BOUNDARY_LOGICAL_ID];
  const name = boundary.Properties.ManagedPolicyName;
  assert.ok(
    typeof name?.["Fn::Sub"] === "string" && name["Fn::Sub"].includes("${NamePrefix}"),
    "ManagedPolicyName must include ${NamePrefix} so teams in one account do not collide",
  );

  const allowed = new Set();
  for (const statement of boundaryStatements()) {
    assert.equal(statement.Effect, "Allow");
    for (const action of asList(statement.Action)) {
      assert.doesNotMatch(action, /^iam:/, `boundary must not grant IAM actions (found ${action})`);
      assert.notEqual(action, "*", "boundary must not grant *");
      allowed.add(action);
    }
  }
  // Union of AWSLambdaBasicExecutionRole, AmazonECSTaskExecutionRolePolicy and
  // AWSAppRunnerServicePolicyForECRAccess: what the canonical Lambda / ECS Fargate /
  // App Runner execution roles need.
  const required = [
    "logs:CreateLogGroup",
    "logs:CreateLogStream",
    "logs:PutLogEvents",
    "ecr:GetAuthorizationToken",
    "ecr:BatchCheckLayerAvailability",
    "ecr:GetDownloadUrlForLayer",
    "ecr:BatchGetImage",
    "ecr:DescribeImages",
  ];
  for (const action of required) {
    assert.ok(allowed.has(action), `boundary is missing ${action}, which an allowed managed policy grants`);
  }
  const extra = [...allowed].filter((action) => !required.includes(action));
  assert.deepEqual(extra, [], `boundary grants more than the migration route needs: ${extra.join(", ")}`);
});

test("every Allow statement that can widen a participant-made role requires the boundary", () => {
  let seen = 0;
  for (const statement of participantStatements()) {
    const actions = asList(statement.Action);
    if (statement.Effect !== "Allow" || !actions.some((action) => ROLE_WIDENING_ACTIONS.includes(action))) continue;
    seen++;
    const condition = statement.Condition?.StringEquals?.["iam:PermissionsBoundary"];
    assert.deepEqual(
      condition,
      BOUNDARY_REF,
      `statement ${statement.Sid ?? "(no Sid)"} grants ${actions.filter((a) => ROLE_WIDENING_ACTIONS.includes(a)).join(", ")} without Condition StringEquals iam:PermissionsBoundary = !Ref ${BOUNDARY_LOGICAL_ID}`,
    );
  }
  assert.ok(seen >= 2, `expected the CreateRole/PutRolePolicy and AttachRolePolicy statements, found ${seen}`);
  for (const action of ROLE_WIDENING_ACTIONS) {
    assert.ok(
      participantStatements().some((statement) => asList(statement.Action).includes(action)),
      `${action} must stay granted (bounded) so the migration route still works`,
    );
  }
});

test("the participant role never gets to swap or remove a role's boundary, and never gets iam wildcards", () => {
  for (const statement of participantStatements()) {
    for (const action of asList(statement.Action)) {
      assert.ok(!NEVER_GRANTED.includes(action), `${action} must not be granted (statement ${statement.Sid})`);
      assert.doesNotMatch(action, /^iam:\*|^\*$/, `wildcard IAM grant in statement ${statement.Sid}`);
    }
  }
});

test("Outputs expose the boundary ARN so participants can pass it as --permissions-boundary", () => {
  const output = template.Outputs.ExecutionRoleBoundaryArn;
  assert.ok(output, "Outputs.ExecutionRoleBoundaryArn is missing");
  assert.deepEqual(output.Value, BOUNDARY_REF, "ExecutionRoleBoundaryArn must be !Ref ExecutionRoleBoundary (= the policy ARN)");
  assert.match(output.Description, /--permissions-boundary/);
});
