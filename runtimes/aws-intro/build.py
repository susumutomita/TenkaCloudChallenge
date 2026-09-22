"""Build the unchanged AWS workshop runtime into a problem-owned CFN artifact."""
import argparse
import json
import subprocess
from pathlib import Path

FAMILY = Path(__file__).resolve().parent


def ref(name): return {"Ref": name}
def sub(value): return {"Fn::Sub": value}
def attr(name, key): return {"Fn::GetAtt": [name, key]}
def policy(statements): return {"Version": "2012-10-17", "Statement": statements}
def allow(actions, resources, condition=None):
    return {"Effect": "Allow", "Action": actions, "Resource": resources, **({"Condition": condition} if condition else {})}
def trust(principal, condition=None):
    return policy([{ "Effect": "Allow", "Principal": principal, "Action": "sts:AssumeRole", **({"Condition": condition} if condition else {})}])


def compile_code(problem):
    code = "\n".join((FAMILY / file).read_text().replace("from check_errors import NotReady, require\n", "").replace("from service_checks import ServiceChecks\n", "").replace("from checks import AwsChecks, NotReady\n", "") for file in ["check_errors.py", "service_checks.py", "checks.py", "app.py"])
    code += "\nCURRICULUM = " + repr(json.loads((problem / "workshop.json").read_text())) + "\n"
    for name, file in [("WEB_HTML", "web.html"), ("WEB_JS", "web.js"), ("WEB_CSS", "web.css")]:
        code += name + " = " + repr((FAMILY / file).read_text()) + "\n"
    code += "\nOBSERVATIONS = " + repr(json.loads((FAMILY / "observations.json").read_text())) + "\n"
    compile(code, "index.py", "exec")
    return code


def template(problem):
    if json.loads((problem / "workshop.json").read_text()).get("labKind", "ec2") != "ec2":
        return service_template(problem)
    tags = [{"Key": "TenkaCloud:NamePrefix", "Value": ref("NamePrefix")}]
    parameters = {
        "NamePrefix": {"Type": "String", "MaxLength": 80, "AllowedPattern": "^tc-[a-z0-9]+(-[a-z0-9]+)+$"},
        "TenkaCloudAccountId": {"Type": "String", "AllowedPattern": "^[0-9]{12}$"},
        "ExternalId": {"Type": "String", "NoEcho": True, "MinLength": 16},
        "AmiId": {"Type": "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>", "Default": "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"},
    }
    for name in ["PlayKey", "ProgressKey", "CompletionSecret"]:
        parameters[name] = {"Type": "String", "NoEcho": True, "MinLength": 24, "MaxLength": 64, "AllowedPattern": "^[A-Za-z0-9]+$"}
    region_condition = {"StringEquals": {"aws:RequestedRegion": ref("AWS::Region")}}
    owned = {"StringEquals": {"aws:ResourceTag/TenkaCloud:NamePrefix": ref("NamePrefix")}}
    request_owned = {"StringEquals": {"aws:RequestTag/TenkaCloud:NamePrefix": ref("NamePrefix")}}
    arn = lambda kind, resource: sub(f"arn:${{AWS::Partition}}:ec2:${{AWS::Region}}:${{AWS::AccountId}}:{kind}/{resource}")
    vpc, eni, sg, route, address = [arn(kind, "${" + name + "}") for kind, name in [
        ("vpc", "Vpc"), ("network-interface", "LabNic"), ("security-group", "LabSecurityGroup"),
        ("route-table", "RouteTable"), ("elastic-ip", "LabAddress.AllocationId")]]
    instances = arn("instance", "*")
    gateways = arn("internet-gateway", "*")
    describe = ["ec2:DescribeInstances", "ec2:DescribeInstanceStatus", "ec2:DescribeNetworkInterfaces", "ec2:DescribeInternetGateways",
        "ec2:DescribeRouteTables", "ec2:DescribeAddresses", "ec2:DescribeSecurityGroups", "ec2:DescribeSubnets", "ec2:DescribeVpcs",
        "ec2:DescribeImages", "ec2:DescribeInstanceTypes", "ec2:DescribeAvailabilityZones", "ec2:DescribeRegions",
        "ec2:DescribeLaunchTemplates", "ec2:DescribeLaunchTemplateVersions", "ec2:DescribeIamInstanceProfileAssociations"]
    r = {
        "Vpc": {"Type": "AWS::EC2::VPC", "Properties": {"CidrBlock": "10.77.0.0/24", "EnableDnsSupport": True, "EnableDnsHostnames": True, "Tags": tags}},
        "Subnet": {"Type": "AWS::EC2::Subnet", "Properties": {"VpcId": ref("Vpc"), "CidrBlock": "10.77.0.0/28", "MapPublicIpOnLaunch": False, "Tags": tags}},
        "RouteTable": {"Type": "AWS::EC2::RouteTable", "Properties": {"VpcId": ref("Vpc"), "Tags": tags}},
        "SubnetRoute": {"Type": "AWS::EC2::SubnetRouteTableAssociation", "Properties": {"SubnetId": ref("Subnet"), "RouteTableId": ref("RouteTable")}},
        "LabSecurityGroup": {"Type": "AWS::EC2::SecurityGroup", "Properties": {"VpcId": ref("Vpc"), "GroupDescription": "Workshop observation port; learners add HTTP", "Tags": tags,
            "SecurityGroupIngress": [{"IpProtocol": "tcp", "FromPort": 8080, "ToPort": 8080, "CidrIp": "0.0.0.0/0"}],
            "SecurityGroupEgress": [{"IpProtocol": "tcp", "FromPort": 443, "ToPort": 443, "CidrIp": "0.0.0.0/0"}]}},
        "LabNic": {"Type": "AWS::EC2::NetworkInterface", "Properties": {"SubnetId": ref("Subnet"), "GroupSet": [ref("LabSecurityGroup")], "Tags": tags}},
        "LabAddress": {"Type": "AWS::EC2::EIP", "Properties": {"Domain": "vpc", "Tags": tags}},
        "InstanceRole": {"Type": "AWS::IAM::Role", "Properties": {"AssumeRolePolicyDocument": trust({"Service": "ec2.amazonaws.com"}), "ManagedPolicyArns": [sub("arn:${AWS::Partition}:iam::aws:policy/AmazonSSMManagedInstanceCore")]}},
        "InstanceProfile": {"Type": "AWS::IAM::InstanceProfile", "Properties": {"InstanceProfileName": sub("${NamePrefix}-session"), "Roles": [ref("InstanceRole")]}},
    }
    server = (FAMILY / "server.py").read_text()
    user_data = "#!/bin/bash\nset -eu\ninstall -d -m 755 /opt/office-link\ncat > /opt/office-link/server.py <<'PY'\n" + server + "\nPY\n"
    user_data += "cat > /etc/systemd/system/office-link.service <<'UNIT'\n[Unit]\nDescription=Office Link lab page\nAfter=network.target\n[Service]\nEnvironment=LAB_NAME=${NamePrefix}\nExecStart=/usr/bin/python3 /opt/office-link/server.py\nRestart=on-failure\n[Install]\nWantedBy=multi-user.target\nUNIT\nsystemctl daemon-reload\nsystemctl enable --now office-link.service\n"
    r["LaunchTemplate"] = {"Type": "AWS::EC2::LaunchTemplate", "Properties": {"TagSpecifications": [{"ResourceType": "launch-template", "Tags": tags}], "LaunchTemplateData": {
        "ImageId": ref("AmiId"), "InstanceType": "t3.micro", "MetadataOptions": {"HttpTokens": "required", "HttpEndpoint": "enabled"},
        "NetworkInterfaces": [{"NetworkInterfaceId": ref("LabNic"), "DeviceIndex": 0, "DeleteOnTermination": False}],
        "BlockDeviceMappings": [{"DeviceName": "/dev/xvda", "Ebs": {"VolumeSize": 8, "VolumeType": "gp3", "DeleteOnTermination": True}}],
        "UserData": {"Fn::Base64": sub(user_data)},
        "TagSpecifications": [{"ResourceType": kind, "Tags": tags + [{"Key": "Name", "Value": sub("${NamePrefix}-server")}]} for kind in ["instance", "volume"]],
    }}}
    template_condition = {"ArnEquals": {"ec2:LaunchTemplate": arn("launch-template", "${LaunchTemplate}")}}
    launch_conditions = {"ArnEquals": template_condition["ArnEquals"], "Bool": {"ec2:IsLaunchTemplateResource": "true"}}
    participant = [
        allow(["cloudshell:CreateEnvironment", "cloudshell:CreateSession", "cloudshell:GetEnvironmentStatus", "cloudshell:StartEnvironment", "cloudshell:StopEnvironment", "cloudshell:DeleteEnvironment", "cloudshell:PutCredentials"], "*"),
        # EC2 Describe APIs do not support resource/tag scopes; each team uses
        # its own AWS account. Mutations below have resource-level boundaries.
        allow(describe, "*", region_condition),
        allow(["ec2:RunInstances"], [eni, sg, arn("subnet", "${Subnet}"), sub("arn:${AWS::Partition}:ec2:${AWS::Region}::image/${AmiId}")], launch_conditions),
        allow(["ec2:RunInstances"], instances, {**template_condition, "StringEquals": {"aws:RequestTag/TenkaCloud:NamePrefix": ref("NamePrefix"), "ec2:InstanceType": "t3.micro"}}),
        allow(["ec2:RunInstances"], arn("volume", "*"), {**template_condition, **request_owned, "NumericLessThanEquals": {"ec2:VolumeSize": "8"}, "StringEquals": {"aws:RequestTag/TenkaCloud:NamePrefix": ref("NamePrefix"), "ec2:VolumeType": "gp3"}}),
        allow(["ec2:RunInstances"], arn("launch-template", "${LaunchTemplate}")),
        allow(["ec2:CreateTags"], [instances, arn("volume", "*"), gateways], {"StringEquals": {"ec2:CreateAction": ["RunInstances", "CreateInternetGateway"], "aws:RequestTag/TenkaCloud:NamePrefix": ref("NamePrefix")}}),
        allow(["ec2:CreateInternetGateway"], "*", request_owned),
        allow(["ec2:AttachInternetGateway"], vpc),
        allow(["ec2:AttachInternetGateway"], gateways, owned),
        allow(["ec2:CreateRoute", "ec2:ReplaceRoute"], route),
        allow(["ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress"], sg),
        allow(["ec2:AssociateIamInstanceProfile", "ec2:ReplaceIamInstanceProfileAssociation"], instances,
            {**owned, "ArnEquals": {"ec2:InstanceProfile": attr("InstanceProfile", "Arn")}}),
        allow(["iam:PassRole"], attr("InstanceRole", "Arn"), {"StringEquals": {"iam:PassedToService": "ec2.amazonaws.com"}}),
        allow(["iam:ListInstanceProfiles"], "*"),
        allow(["iam:GetInstanceProfile"], attr("InstanceProfile", "Arn")),
        allow(["iam:GetRole"], attr("InstanceRole", "Arn")),
        allow(["ssm:DescribeInstanceInformation", "ssm:DescribeInstanceProperties", "ssm:GetConnectionStatus", "ssm:DescribeSessions"], "*", region_condition),
        allow(["ssm:StartSession"], instances, {"StringEquals": {"ssm:resourceTag/TenkaCloud:NamePrefix": ref("NamePrefix")}}),
        allow(["ssm:StartSession"], [sub("arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:document/SSM-SessionManagerRunShell"), sub("arn:${AWS::Partition}:ssm:${AWS::Region}::document/SSM-SessionManagerRunShell")]),
        allow(["ssmmessages:OpenDataChannel"], sub("arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:session/${!aws:userid}-*")),
        # AWS's end-user Session Manager policy scopes these to the caller's
        # session ARN, just like OpenDataChannel (no synthetic session tag).
        allow(["ssm:TerminateSession", "ssm:ResumeSession"], sub("arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:session/${!aws:userid}-*")),
    ]
    r["ParticipantViewerRole"] = {"Type": "AWS::IAM::Role", "Properties": {
        "AssumeRolePolicyDocument": trust({"AWS": sub("arn:${AWS::Partition}:iam::${TenkaCloudAccountId}:root")}, {"StringEquals": {"sts:ExternalId": ref("ExternalId")}}),
        "ManagedPolicyArns": ["arn:aws:iam::aws:policy/SignInLocalDevelopmentAccess"],
        "Policies": [{"PolicyName": "OperateOnlyThisLab", "PolicyDocument": policy(participant)}]}}
    config = {"namePrefix": "${NamePrefix}", "serverName": "${NamePrefix}-server", "publicIp": "${LabAddress}", "partition": "${AWS::Partition}", "region": "${AWS::Region}", "accountId": "${AWS::AccountId}",
        "vpcId": "${Vpc}", "subnetId": "${Subnet}", "networkInterfaceId": "${LabNic}", "allocationId": "${LabAddress.AllocationId}",
        "routeTableId": "${RouteTable}", "securityGroupId": "${LabSecurityGroup}", "instanceProfileArn": "${InstanceProfile.Arn}",
        "instanceProfileName": "${InstanceProfile}", "participantRoleName": "${ParticipantViewerRole}",
        "imageId": "${AmiId}", "instanceType": "t3.micro", "launchTemplateId": "${LaunchTemplate}", "httpSourceCidr": "0.0.0.0/0"}
    environment = {"LAB_CONFIG": sub(json.dumps(config))}
    for name in ["Workshop", "Cleanup"]:
        r[name + "Logs"] = {"Type": "AWS::Logs::LogGroup", "Properties": {"RetentionInDays": 1, "Tags": tags}}
        statements = [allow(describe + ["ssm:DescribeSessions"], "*", region_condition), allow(["logs:CreateLogStream", "logs:PutLogEvents"], attr(name + "Logs", "Arn"))]
        if name == "Workshop":
            statements += [allow(["ec2:AssociateAddress"], [address, eni]), allow(["ec2:AssociateAddress"], instances, owned)]
        else:
            statements += [allow(["ec2:DisassociateAddress"], [address, eni]), allow(["ec2:TerminateInstances"], instances, owned),
                allow(["ec2:ModifyInstanceAttribute"], instances, {"StringEquals": {**owned["StringEquals"], "ec2:Attribute": "disableApiTermination"}}),
                allow(["ec2:DetachInternetGateway"], vpc), allow(["ec2:DetachInternetGateway", "ec2:DeleteInternetGateway"], gateways, owned)]
        r[name + "Role"] = {"Type": "AWS::IAM::Role", "Properties": {"AssumeRolePolicyDocument": trust({"Service": "lambda.amazonaws.com"}), "Policies": [{"PolicyName": "LabAuthority", "PolicyDocument": policy(statements)}]}}
        variables = dict(environment)
        if name == "Workshop":
            variables.update(PLAY_KEY=ref("PlayKey"), PROGRESS_KEY=ref("ProgressKey"), FLAG_COMPLETION=ref("CompletionSecret"))
        r[name] = {"Type": "AWS::Lambda::Function", "Properties": {"Runtime": "python3.12", "Handler": "index.handler", "MemorySize": 128,
            "Timeout": 30 if name == "Workshop" else 240, "Role": attr(name + "Role", "Arn"), "LoggingConfig": {"LogGroup": ref(name + "Logs")},
            "Environment": {"Variables": variables}, "Code": {"ZipFile": compile_code(problem) if name == "Workshop" else (FAMILY / "cleanup.py").read_text()}, "Tags": tags}}
    r["CleanupHook"] = {"Type": "Custom::OfficeLabCleanup", "Properties": {"ServiceToken": attr("Cleanup", "Arn")}}
    r["WorkshopUrl"] = {"Type": "AWS::Lambda::Url", "Properties": {"TargetFunctionArn": attr("Workshop", "Arn"), "AuthType": "NONE"}}
    r["UrlAccess"] = {"Type": "AWS::Lambda::Permission", "Properties": {"FunctionName": ref("Workshop"), "Action": "lambda:InvokeFunctionUrl", "Principal": "*", "FunctionUrlAuthType": "NONE"}}
    r["UrlInvocation"] = {"Type": "AWS::Lambda::Permission", "Properties": {"FunctionName": ref("Workshop"), "Action": "lambda:InvokeFunction", "Principal": "*", "InvokedViaFunctionUrl": True}}
    return {"AWSTemplateFormatVersion": "2010-09-09", "Description": "AWS introductory team Challenge: real EC2 launch, internet access, Session Manager and HTTP checks.",
        "Parameters": parameters, "Resources": r, "Outputs": {
            "GameUrl": {"Description": "Team-private mission board", "Value": sub("${WorkshopUrl.FunctionUrl}${PlayKey}/")},
            "ParticipantViewerRoleArn": {"Value": attr("ParticipantViewerRole", "Arn")},
            "CompletionFlag": {"Description": "Scorer only; filtered from participant output", "Value": sub("TC{${CompletionSecret}}")},
        }}


def build(problem, check=False):
    # Match the catalog's YAML contract using its already-pinned dependency.
    rendered = subprocess.run(["bun", "-e", "import {stringify} from 'yaml'; process.stdout.write(stringify(JSON.parse(await Bun.stdin.text()), {lineWidth:0}));"], input=json.dumps(template(problem)), text=True, capture_output=True, check=True, cwd=problem).stdout
    output = problem / "template.yaml"
    if check:
        if not output.exists() or output.read_text() != rendered:
            raise SystemExit("Generated template differs: run make build")
    else:
        output.write_text(rendered)




def service_template(problem):
    """Same board and receipt contract, with bounded service-specific resources."""
    curriculum=json.loads((problem/'workshop.json').read_text())
    kind=curriculum['labKind']
    tags=[{'Key':'TenkaCloud:NamePrefix','Value':ref('NamePrefix')}]
    parameters={
        'NamePrefix':{'Type':'String','MaxLength':71,'AllowedPattern':'^tc-[a-z0-9]+(-[a-z0-9]+)+$'},
        'TenkaCloudAccountId':{'Type':'String','AllowedPattern':'^[0-9]{12}$'},
        'ExternalId':{'Type':'String','NoEcho':True,'MinLength':16},
    }
    for name in ['PlayKey','ProgressKey','CompletionSecret']:
        parameters[name]={'Type':'String','NoEcho':True,'MinLength':24,'MaxLength':64,'AllowedPattern':'^[A-Za-z0-9]+$'}
    config={'namePrefix':'${NamePrefix}','region':'${AWS::Region}','labKind':kind}
    r={}
    participant=[allow(['cloudshell:CreateEnvironment','cloudshell:CreateSession','cloudshell:GetEnvironmentStatus','cloudshell:StartEnvironment','cloudshell:StopEnvironment','cloudshell:DeleteEnvironment','cloudshell:PutCredentials'],'*')]
    checker=[]
    lifecycle=[]
    if kind in ['s3-save','s3-restore']:
        r['Bucket']={'Type':'AWS::S3::Bucket','Properties':{
            'BucketEncryption':{'ServerSideEncryptionConfiguration':[{'ServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]},
            'PublicAccessBlockConfiguration':{key:True for key in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']},
            'VersioningConfiguration':{'Status':'Enabled'},
            'OwnershipControls':{'Rules':[{'ObjectOwnership':'BucketOwnerEnforced'}]}, 'Tags':tags}}
        config.update(bucketName='${Bucket}',objectKey='handover.txt',fileContent='Office link: meeting room A\n')
        bucket=attr('Bucket','Arn'); object_arn=sub('${Bucket.Arn}/handover.txt')
        participant += [allow(['s3:ListAllMyBuckets'],'*'),
            allow(['s3:GetBucketLocation','s3:GetBucketVersioning','s3:GetBucketPublicAccessBlock','s3:ListBucket','s3:ListBucketVersions'],bucket),
            allow(['s3:GetObject','s3:GetObjectVersion','s3:PutObject'],object_arn)]
        checker += [allow(['s3:GetBucketPublicAccessBlock','s3:GetBucketVersioning','s3:ListBucketVersions'],bucket),allow(['s3:GetObject'],object_arn)]
        lifecycle += [allow(['s3:ListBucketVersions'],bucket),allow(['s3:PutObject','s3:DeleteObject','s3:DeleteObjectVersion'],sub('${Bucket.Arn}/*'))]
    elif kind in ['lambda-run','lambda-logs']:
        r['StudentLogs']={'Type':'AWS::Logs::LogGroup','Properties':{'RetentionInDays':1,'Tags':tags}}
        r['StudentRole']={'Type':'AWS::IAM::Role','Properties':{'AssumeRolePolicyDocument':trust({'Service':'lambda.amazonaws.com'}),
            'Policies':[{'PolicyName':'WriteOwnExecutionLog','PolicyDocument':policy([allow(['logs:CreateLogStream','logs:PutLogEvents'],attr('StudentLogs','Arn'))])}]}}
        r['StudentFunction']={'Type':'AWS::Lambda::Function','Properties':{'Runtime':'python3.12','Handler':'index.handler','Timeout':3,'MemorySize':128,
            'Role':attr('StudentRole','Arn'),'LoggingConfig':{'LogGroup':ref('StudentLogs')},'Environment':{'Variables':{'TEAM_NAME':ref('NamePrefix')}},
            'Code':{'ZipFile':(FAMILY/'student_lambda.py').read_text()},'Tags':tags}}
        config.update(functionName='${StudentFunction}',studentLogGroup='${StudentLogs}',testEvent=json.dumps({'team':'${NamePrefix}','parcels':3}))
        participant += [allow(['lambda:InvokeFunction','lambda:GetFunction','lambda:GetFunctionConfiguration','lambda:ListVersionsByFunction','lambda:GetPolicy','lambda:ListTags'],attr('StudentFunction','Arn')),
            allow(['logs:DescribeLogGroups'],'*'),allow(['logs:DescribeLogStreams','logs:GetLogEvents','logs:FilterLogEvents'],attr('StudentLogs','Arn'))]
        checker += [allow(['logs:FilterLogEvents'],attr('StudentLogs','Arn'))]
    elif kind == 'dynamodb':
        config.update(tableName='${NamePrefix}-handover')
        table=sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${NamePrefix}-handover')
        participant += [allow(['dynamodb:ListTables','dynamodb:DescribeEndpoints'],'*'),
            allow(['dynamodb:CreateTable','dynamodb:DescribeTable','dynamodb:PutItem','dynamodb:GetItem','dynamodb:UpdateItem','dynamodb:Scan','dynamodb:Query','dynamodb:ListTagsOfResource'],table)]
        checker += [allow(['dynamodb:DescribeTable','dynamodb:GetItem'],table)]
        lifecycle += [allow(['dynamodb:DescribeTable','dynamodb:UpdateTable','dynamodb:DeleteTable'],table)]
    elif kind == 'sqs':
        queue=sub('arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:${NamePrefix}-handover')
        config.update(queueName='${NamePrefix}-handover',queueArn='arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:${NamePrefix}-handover',accountId='${AWS::AccountId}')
        # DeleteMessageBatch is authorized by sqs:DeleteMessage (there is no
        # separate IAM action with the Batch API name).
        participant += [allow(['sqs:ListQueues'],'*'),allow(['sqs:CreateQueue','sqs:GetQueueUrl','sqs:GetQueueAttributes','sqs:ListQueueTags','sqs:SendMessage','sqs:ReceiveMessage','sqs:DeleteMessage'],queue)]
        checker += [allow(['sqs:GetQueueUrl','sqs:GetQueueAttributes'],queue),allow(['cloudwatch:GetMetricStatistics'],'*')]
        lifecycle += [allow(['sqs:GetQueueUrl','sqs:DeleteQueue'],queue)]
    elif kind == 'cpu-alarm':
        parameters['AmiId']={'Type':'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>','Default':'/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64'}
        r['Vpc']={'Type':'AWS::EC2::VPC','Properties':{'CidrBlock':'10.78.0.0/24','Tags':tags}}
        r['Subnet']={'Type':'AWS::EC2::Subnet','Properties':{'VpcId':ref('Vpc'),'CidrBlock':'10.78.0.0/28','MapPublicIpOnLaunch':False,'Tags':tags}}
        r['ServerGroup']={'Type':'AWS::EC2::SecurityGroup','Properties':{'VpcId':ref('Vpc'),'GroupDescription':'CPU observation only; no inbound traffic','Tags':tags}}
        r['Server']={'Type':'AWS::EC2::Instance','Properties':{'ImageId':ref('AmiId'),'InstanceType':'t3.micro','SubnetId':ref('Subnet'),'SecurityGroupIds':[ref('ServerGroup')],
            'MetadataOptions':{'HttpTokens':'required'},'BlockDeviceMappings':[{'DeviceName':'/dev/xvda','Ebs':{'VolumeSize':8,'VolumeType':'gp3','DeleteOnTermination':True}}],
            'Tags':tags+[{'Key':'Name','Value':sub('${NamePrefix}-observe')}],'Monitoring':False}}
        config.update(instanceId='${Server}',alarmName='${NamePrefix}-cpu')
        alarm=sub('arn:${AWS::Partition}:cloudwatch:${AWS::Region}:${AWS::AccountId}:alarm:${NamePrefix}-cpu')
        participant += [allow(['ec2:DescribeInstances','cloudwatch:ListMetrics','cloudwatch:GetMetricData','cloudwatch:GetMetricStatistics'],'*'),
            allow(['cloudwatch:DescribeAlarms','cloudwatch:DescribeAlarmHistory','cloudwatch:ListTagsForResource'],alarm),
            allow(['cloudwatch:PutMetricAlarm'],alarm,{'Null':{'cloudwatch:AlarmActions':'true'}})]
        checker += [allow(['cloudwatch:DescribeAlarms'],alarm)]
        lifecycle += [allow(['cloudwatch:DeleteAlarms'],alarm)]
    else:
        raise ValueError('Unsupported service lab: '+kind)
    r['ParticipantViewerRole']={'Type':'AWS::IAM::Role','Properties':{
        'AssumeRolePolicyDocument':trust({'AWS':sub('arn:${AWS::Partition}:iam::${TenkaCloudAccountId}:root')},{'StringEquals':{'sts:ExternalId':ref('ExternalId')}}),
        'ManagedPolicyArns':['arn:aws:iam::aws:policy/SignInLocalDevelopmentAccess'],
        'Policies':[{'PolicyName':'OperateOnlyThisLab','PolicyDocument':policy(participant)}]}}
    functions=[('Workshop',checker)] + ([('Lifecycle',lifecycle)] if lifecycle else [])
    for name,statements in functions:
        r[name+'Logs']={'Type':'AWS::Logs::LogGroup','Properties':{'RetentionInDays':1,'Tags':tags}}
        r[name+'Role']={'Type':'AWS::IAM::Role','Properties':{'AssumeRolePolicyDocument':trust({'Service':'lambda.amazonaws.com'}),
            'Policies':[{'PolicyName':'LabAuthority','PolicyDocument':policy(statements+[allow(['logs:CreateLogStream','logs:PutLogEvents'],attr(name+'Logs','Arn'))])}]}}
        variables={'LAB_CONFIG':sub(json.dumps(config))}
        if name=='Workshop': variables.update(PLAY_KEY=ref('PlayKey'),PROGRESS_KEY=ref('ProgressKey'),FLAG_COMPLETION=ref('CompletionSecret'))
        r[name]={'Type':'AWS::Lambda::Function','Properties':{'Runtime':'python3.12','Handler':'index.handler','MemorySize':128,
            'Timeout':30 if name=='Workshop' else 240,'Role':attr(name+'Role','Arn'),'LoggingConfig':{'LogGroup':ref(name+'Logs')},
            'Environment':{'Variables':variables},'Tags':tags,'Code':{'ZipFile':compile_code(problem) if name=='Workshop' else (FAMILY/'service_lifecycle.py').read_text()}}}
    if lifecycle:
        r['DataLifecycle']={'Type':'Custom::WorkshopData','Properties':{'ServiceToken':attr('Lifecycle','Arn')}}
    r['WorkshopUrl']={'Type':'AWS::Lambda::Url','Properties':{'TargetFunctionArn':attr('Workshop','Arn'),'AuthType':'NONE'}}
    r['UrlAccess']={'Type':'AWS::Lambda::Permission','Properties':{'FunctionName':ref('Workshop'),'Action':'lambda:InvokeFunctionUrl','Principal':'*','FunctionUrlAuthType':'NONE'}}
    r['UrlInvocation']={'Type':'AWS::Lambda::Permission','Properties':{'FunctionName':ref('Workshop'),'Action':'lambda:InvokeFunction','Principal':'*','InvokedViaFunctionUrl':True}}
    return {'AWSTemplateFormatVersion':'2010-09-09','Description':'AWS introductory team Challenge: '+kind,
        'Parameters':parameters,'Resources':r,'Outputs':{'GameUrl':{'Value':sub('${WorkshopUrl.FunctionUrl}${PlayKey}/')},
        'ParticipantViewerRoleArn':{'Value':attr('ParticipantViewerRole','Arn')},'CompletionFlag':{'Value':sub('TC{${CompletionSecret}}')}}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("problem", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    build(args.problem.resolve(), args.check)
