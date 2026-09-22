"""Compose the existing EC2 lab and uptime contract; no platform exception."""
import argparse
import copy
import json
import runpy
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parent
FAMILY=ROOT.parents[1]/'runtimes'/'aws-intro'
shared=runpy.run_path(str(FAMILY/'build.py'))
ref,sub,attr,allow,policy,trust=[shared[k] for k in ['ref','sub','attr','allow','policy','trust']]


def compile_code():
    code='\n'.join((FAMILY/name).read_text().replace('from check_errors import NotReady, require\n','').replace('from service_checks import ServiceChecks\n','') for name in ['check_errors.py','service_checks.py','checks.py'])
    code+='\n'+(ROOT/'controller.py').read_text().replace('from checks import AwsChecks, NotReady\n','')+'\n'+(ROOT/'app.py').read_text()
    code+='\nROUNDS = '+repr(json.loads((ROOT/'rounds.json').read_text()))+'\n'
    observations=json.loads((FAMILY/'observations.json').read_text())
    observations['Attach the prepared EC2 role to restore management access']='用意されたEC2用ロールを付け、管理用の接続を戻してください。'
    code+='OBSERVATIONS = '+repr(observations)+'\n'
    for name,filename in [('WEB_HTML','web.html'),('WEB_CSS','web.css'),('WEB_JS','web.js')]:code+=name+' = '+repr((ROOT/filename).read_text())+'\n'
    compile(code,'index.py','exec')
    return code


def template():
    t=shared['template'](ROOT.parents[1]/'challenges'/'office-link-gate')
    t['Description']='One real AWS recovery fault at a time, using existing uptime-flat scoring.'
    for key in ['ProgressKey','CompletionSecret']:del t['Parameters'][key]
    r=t['Resources'];tags=r['Vpc']['Properties']['Tags']
    arn=lambda kind,name:sub('arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:'+kind+'/'+name)
    r['Gateway']={'Type':'AWS::EC2::InternetGateway','Properties':{'Tags':tags}}
    r['GatewayAttachment']={'Type':'AWS::EC2::VPCGatewayAttachment','Properties':{'VpcId':ref('Vpc'),'InternetGatewayId':ref('Gateway')}}
    r['DefaultRoute']={'Type':'AWS::EC2::Route','DependsOn':'GatewayAttachment','Properties':{'RouteTableId':ref('RouteTable'),'DestinationCidrBlock':'0.0.0.0/0','GatewayId':ref('Gateway')}}
    r['LabSecurityGroup']['Properties']['SecurityGroupIngress'].append({'IpProtocol':'tcp','FromPort':80,'ToPort':80,'CidrIp':'0.0.0.0/0'})
    r['LaunchTemplate']['Properties']['LaunchTemplateData']['IamInstanceProfile']={'Arn':attr('InstanceProfile','Arn')}
    r['Server']={'Type':'AWS::EC2::Instance','DependsOn':'GatewayAttachment','Properties':{'Tags':tags,'LaunchTemplate':{'LaunchTemplateId':ref('LaunchTemplate'),'Version':attr('LaunchTemplate','LatestVersionNumber')}}}
    r['PublicAddress']={'Type':'AWS::EC2::EIPAssociation','DependsOn':['Server','GatewayAttachment'],'Properties':{'AllocationId':attr('LabAddress','AllocationId'),'NetworkInterfaceId':ref('LabNic')}}
    r['RoundState']={'Type':'AWS::DynamoDB::Table','Properties':{'BillingMode':'PAY_PER_REQUEST','AttributeDefinitions':[{'AttributeName':'id','AttributeType':'S'}],'KeySchema':[{'AttributeName':'id','KeyType':'HASH'}],'Tags':tags}}
    # The server is prepared. A participant cannot launch replacements, create
    # new gateways or edit the controller, timer, scoring URL or state table.
    participant=r['ParticipantViewerRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
    for stmt in list(participant):
        if any(a in stmt['Action'] for a in ['ec2:RunInstances','ec2:CreateTags','ec2:CreateInternetGateway']):participant.remove(stmt)
        elif 'ec2:AttachInternetGateway' in stmt['Action'] and 'internet-gateway/*' in json.dumps(stmt['Resource']):
            stmt['Resource']=arn('internet-gateway','${Gateway}');stmt.pop('Condition',None)
    config=json.loads(r['Workshop']['Properties']['Environment']['Variables']['LAB_CONFIG']['Fn::Sub'])
    config.update(gatewayId='${Gateway}',stateTable='${RoundState}')
    for name in ['Workshop','Cleanup']:
        r[name]['Properties']['Environment']['Variables']={'LAB_CONFIG':sub(json.dumps(config))}
    r['Workshop']['Properties']['Environment']['Variables']['PLAY_KEY']=ref('PlayKey')
    r['Workshop']['Properties']['Code']['ZipFile']=compile_code()
    state_permissions=allow(['dynamodb:GetItem','dynamodb:PutItem'],attr('RoundState','Arn'))
    r['WorkshopRole']['Properties']['Policies'][0]['PolicyDocument']['Statement'].append(state_permissions)
    r['FaultLogs']={'Type':'AWS::Logs::LogGroup','Properties':{'RetentionInDays':1,'Tags':tags}}
    ec2_describe=[a for stmt in r['WorkshopRole']['Properties']['Policies'][0]['PolicyDocument']['Statement'] for a in stmt['Action'] if a.startswith('ec2:Describe')]
    faults=[allow(ec2_describe+['ssm:DescribeSessions'],'*'),state_permissions,allow(['logs:CreateLogStream','logs:PutLogEvents'],attr('FaultLogs','Arn')),
        allow(['ec2:AssociateAddress','ec2:DisassociateAddress'],[arn('elastic-ip','${LabAddress.AllocationId}'),arn('network-interface','${LabNic}'),arn('instance','${Server}')]),
        allow(['ec2:AttachInternetGateway','ec2:DetachInternetGateway'],[arn('vpc','${Vpc}'),arn('internet-gateway','${Gateway}')]),
        allow(['ec2:CreateRoute','ec2:ReplaceRoute','ec2:DeleteRoute'],arn('route-table','${RouteTable}')),
        allow(['ec2:AssociateIamInstanceProfile','ec2:DisassociateIamInstanceProfile','ec2:ReplaceIamInstanceProfileAssociation'],arn('instance','${Server}')),
        allow(['iam:PassRole'],attr('InstanceRole','Arn'),{'StringEquals':{'iam:PassedToService':'ec2.amazonaws.com'}}),
        allow(['ec2:AuthorizeSecurityGroupIngress','ec2:RevokeSecurityGroupIngress'],arn('security-group','${LabSecurityGroup}'))]
    r['FaultRole']={'Type':'AWS::IAM::Role','Properties':{'AssumeRolePolicyDocument':trust({'Service':'lambda.amazonaws.com'}),'Policies':[{'PolicyName':'FaultAndRestoreOnlyThisLab','PolicyDocument':policy(faults)}]}}
    r['FaultController']={'Type':'AWS::Lambda::Function','Properties':{'Runtime':'python3.12','Handler':'index.operator_handler','MemorySize':128,'Timeout':120,
        'Role':attr('FaultRole','Arn'),'Environment':{'Variables':{'LAB_CONFIG':sub(json.dumps(config))}},'Code':{'ZipFile':compile_code()},'LoggingConfig':{'LogGroup':ref('FaultLogs')},'Tags':tags}}
    r['Watchdog']={'Type':'AWS::Events::Rule','DependsOn':'CleanupHook','Properties':{'ScheduleExpression':'rate(1 minute)','State':'ENABLED','Targets':[{'Id':'RestoreExpiredFault','Arn':attr('FaultController','Arn')}]}}
    r['WatchdogAccess']={'Type':'AWS::Lambda::Permission','Properties':{'FunctionName':ref('FaultController'),'Action':'lambda:InvokeFunction','Principal':'events.amazonaws.com','SourceArn':attr('Watchdog','Arn')}}
    r['WorkshopUrl']['DependsOn']='CleanupHook'
    t['Outputs']={'GameUrl':{'Description':'Team recovery board','Value':sub('${WorkshopUrl.FunctionUrl}${PlayKey}/')},
        'HealthUrlHint':{'Description':'Register this base URL in the health slot to begin uptime scoring','Value':sub('${WorkshopUrl.FunctionUrl}${PlayKey}/')},
        'HealthUrl':{'Description':'Intentionally empty until participant registration','Value':''},
        'ParticipantViewerRoleArn':{'Value':attr('ParticipantViewerRole','Arn')},
        'FaultControllerName':{'Description':'Operator only; invoke through authorized AWS credentials','Value':ref('FaultController')},
        'InstanceId':{'Value':ref('Server')}}
    return t


def build(check=False):
    rendered=subprocess.run(['bun','-e',"import {stringify} from 'yaml'; process.stdout.write(stringify(JSON.parse(await Bun.stdin.text()), {lineWidth:0}));"],input=json.dumps(template()),text=True,capture_output=True,check=True,cwd=ROOT).stdout
    target=ROOT/'template.yaml'
    if check:
        if not target.exists() or target.read_text()!=rendered:raise SystemExit('Run make build; generated template is stale')
    else:target.write_text(rendered)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');build(parser.parse_args().check)
