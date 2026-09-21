"""Generate the self-contained CFN artifact. No AWS calls; --check rejects drift."""
import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAMES = ["Delivery", "DeliveryWhy", "Sharing", "SharingWhy", "Restore", "RestoreWhy"]
ENV_NAMES = ["DELIVERY", "DELIVERY_WHY", "SHARING", "SHARING_WHY", "RESTORE", "RESTORE_WHY"]


def template():
    code = (ROOT / "app.py").read_text()
    for variable, file in [("WEB_HTML", "web.html"), ("WEB_JS", "web.js"), ("WEB_CSS", "web.css")]:
        code += "\n" + variable + " = " + repr((ROOT / file).read_text()) + "\n"
    parameters = {
        "NamePrefix": {"Type": "String", "AllowedPattern": "^tc-[a-z0-9]+(-[a-z0-9]+)+$", "MaxLength": 84},
        "TenkaCloudAccountId": {"Type": "String", "AllowedPattern": "^[0-9]{12}$"},
        "ExternalId": {"Type": "String", "NoEcho": True, "MinLength": 16},
    }
    for name in ["PlayKey"] + [n + "Secret" for n in NAMES]:
        parameters[name] = {"Type": "String", "NoEcho": True, "MinLength": 24, "MaxLength": 64, "AllowedPattern": "^[A-Za-z0-9]+$"}
    variables = {"PLAY_KEY": {"Ref": "PlayKey"}}
    variables.update({"FLAG_" + env: {"Ref": name + "Secret"} for name, env in zip(NAMES, ENV_NAMES)})
    assume = lambda principal, condition=None: {"Version": "2012-10-17", "Statement": [{
        "Effect": "Allow", "Principal": principal, "Action": "sts:AssumeRole",
        **({"Condition": condition} if condition else {}),
    }]}
    resources = {
        "WorkshopLogs": {"Type": "AWS::Logs::LogGroup", "Properties": {
            "LogGroupName": {"Fn::Sub": "/aws/lambda/${NamePrefix}-office"}, "RetentionInDays": 1,
        }},
        "WorkshopRole": {"Type": "AWS::IAM::Role", "Properties": {
            "AssumeRolePolicyDocument": assume({"Service": "lambda.amazonaws.com"}),
            "Policies": [{"PolicyName": "WriteOwnLogs", "PolicyDocument": {"Version": "2012-10-17", "Statement": [{
                "Effect": "Allow", "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
                "Resource": {"Fn::GetAtt": ["WorkshopLogs", "Arn"]},
            }]}}],
        }},
        "Workshop": {"Type": "AWS::Lambda::Function", "Properties": {
            "Runtime": "python3.12", "Handler": "index.handler", "MemorySize": 128, "Timeout": 5,
            "LoggingConfig": {"LogGroup": {"Ref": "WorkshopLogs"}},
            "Role": {"Fn::GetAtt": ["WorkshopRole", "Arn"]},
            "Environment": {"Variables": variables}, "Code": {"ZipFile": code},
            "Tags": [{"Key": "TenkaCloud:NamePrefix", "Value": {"Ref": "NamePrefix"}}],
        }},
        "WorkshopUrl": {"Type": "AWS::Lambda::Url", "Properties": {
            "TargetFunctionArn": {"Fn::GetAtt": ["Workshop", "Arn"]}, "AuthType": "NONE",
        }},
        "UrlAccess": {"Type": "AWS::Lambda::Permission", "Properties": {
            "FunctionName": {"Ref": "Workshop"}, "Action": "lambda:InvokeFunctionUrl", "Principal": "*", "FunctionUrlAuthType": "NONE",
        }},
        "UrlInvocation": {"Type": "AWS::Lambda::Permission", "Properties": {
            "FunctionName": {"Ref": "Workshop"}, "Action": "lambda:InvokeFunction", "Principal": "*", "InvokedViaFunctionUrl": True,
        }},
        # No GetFunction/GetFunctionConfiguration/DescribeStacks grants: these
        # would expose the scoring authority stored in environment or outputs.
        "ParticipantViewerRole": {"Type": "AWS::IAM::Role", "Properties": {
            "MaxSessionDuration": 3600,
            "AssumeRolePolicyDocument": assume({"AWS": {"Fn::Sub": "arn:${AWS::Partition}:iam::${TenkaCloudAccountId}:root"}}, {"StringEquals": {"sts:ExternalId": {"Ref": "ExternalId"}}}),
            "ManagedPolicyArns": ["arn:aws:iam::aws:policy/SignInLocalDevelopmentAccess"],
            "Policies": [{"PolicyName": "ConsoleSessionBaseline", "PolicyDocument": {"Version": "2012-10-17", "Statement": [{
                "Effect": "Allow", "Resource": "*", "Action": [
                    "cloudshell:CreateEnvironment", "cloudshell:CreateSession", "cloudshell:GetEnvironmentStatus",
                    "cloudshell:StartEnvironment", "cloudshell:StopEnvironment", "cloudshell:DeleteEnvironment", "cloudshell:PutCredentials",
                ],
            }]}}],
        }},
    }
    outputs = {
        "GameUrl": {"Description": "Team-private workshop link. Share only with your teammates.", "Value": {"Fn::Sub": "${WorkshopUrl.FunctionUrl}${PlayKey}/"}},
        "ParticipantViewerRoleArn": {"Value": {"Fn::GetAtt": ["ParticipantViewerRole", "Arn"]}},
    }
    for name in NAMES:
        outputs[name + "Flag"] = {"Description": "Scorer only; filtered from participant outputs.", "Value": {"Fn::Sub": "TC{${" + name + "Secret}}"}}
    return {"AWSTemplateFormatVersion": "2010-09-09", "Description": "Office Link: browser-based team missions and scored explanations. No real document changes.", "Parameters": parameters, "Resources": resources, "Outputs": outputs}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    # Reuse the catalog's pinned YAML dependency; no Python package installation.
    contents = subprocess.run(["bun", "-e", "import {stringify} from 'yaml'; process.stdout.write(stringify(JSON.parse(await Bun.stdin.text()), {lineWidth:0}));"], input=json.dumps(template()), text=True, capture_output=True, check=True, cwd=ROOT).stdout
    path = ROOT / "template.yaml"
    if args.check:
        if not path.exists() or path.read_text() != contents:
            raise SystemExit("template.yaml is stale; run make build")
        print("CloudFormation artifact matches the tested source.")
    else:
        path.write_text(contents)
