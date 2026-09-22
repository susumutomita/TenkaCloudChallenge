"""Actual AWS evidence predicates, isolation, and teardown for optional basics."""
import copy
import json
import os
import runpy
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

FAMILY=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(FAMILY))
from checks import AwsChecks, NotReady
builder=runpy.run_path(str(FAMILY/'build.py'))
lifecycle=runpy.run_path(str(FAMILY/'service_lifecycle.py'))

class BasicServiceTest(unittest.TestCase):
    def setUp(self):
        self.db=Mock();self.sqs=Mock();self.cw=Mock()
        self.config={'region':'ap-northeast-1','tableName':'tc-team-handover','queueName':'tc-team-handover','queueArn':'arn:aws:sqs:ap-northeast-1:123456789012:tc-team-handover','accountId':'123456789012','instanceId':'i-team','alarmName':'tc-team-cpu'}
        self.table={'TableStatus':'ACTIVE','KeySchema':[{'AttributeName':'recordId','KeyType':'HASH'}],'AttributeDefinitions':[{'AttributeName':'recordId','AttributeType':'S'}],'BillingModeSummary':{'BillingMode':'PAY_PER_REQUEST'}}
        self.db.describe_table.return_value={'Table':self.table}
        self.db.get_item.return_value={'Item':{'recordId':{'S':'handover'},'destination':{'S':'YOKOHAMA'},'status':{'S':'waiting'}}}
        self.attrs={'QueueArn':self.config['queueArn'],'DelaySeconds':'0','VisibilityTimeout':'30','MessageRetentionPeriod':'345600','CreatedTimestamp':str(int(datetime.now(timezone.utc).timestamp())),'SqsManagedSseEnabled':'true','ApproximateNumberOfMessages':'0','ApproximateNumberOfMessagesNotVisible':'0','ApproximateNumberOfMessagesDelayed':'0'}
        self.sqs.get_queue_url.return_value={'QueueUrl':'https://sqs.ap-northeast-1.amazonaws.com/123456789012/tc-team-handover'}
        self.sqs.get_queue_attributes.return_value={'Attributes':self.attrs}
        self.cw.get_metric_statistics.return_value={'Datapoints':[{'Sum':1}]}
        self.alarm={'Namespace':'AWS/EC2','MetricName':'CPUUtilization','Dimensions':[{'Name':'InstanceId','Value':'i-team'}],'Statistic':'Average','Period':300,'EvaluationPeriods':1,'ComparisonOperator':'GreaterThanThreshold','Threshold':80,'StateValue':'INSUFFICIENT_DATA'}
        self.cw.describe_alarms.return_value={'MetricAlarms':[self.alarm]}
        self.check=AwsChecks(self.config,{'dynamodb':self.db,'sqs':self.sqs,'cloudwatch':self.cw})

    def test_dynamodb_creation_and_update_are_separate_observations(self):
        self.assertEqual(self.check.run('dynamodb-create')['status'],'waiting')
        self.db.get_item.assert_called_with(TableName='tc-team-handover',Key={'recordId':{'S':'handover'}},ConsistentRead=True)
        with self.assertRaises(NotReady): self.check.run('dynamodb-update')
        self.db.get_item.return_value['Item']['status']={'S':'done'}
        self.assertEqual(self.check.run('dynamodb-update')['status'],'done')
        with self.assertRaises(NotReady): self.check.run('dynamodb-create')
        self.db.get_item.return_value['Item']['destination']={'S':'SHIZUOKA'}
        with self.assertRaises(NotReady): self.check.run('dynamodb-update')

    def test_dynamodb_does_not_ignore_configuration_or_aws_failures(self):
        for changed in [{'KeySchema':[]},{'BillingModeSummary':{'BillingMode':'PROVISIONED'}},{'TableStatus':'CREATING'},{'GlobalSecondaryIndexes':[{'IndexName':'extra'}]}]:
            self.db.describe_table.return_value={'Table':{**self.table,**changed}}
            with self.assertRaises(NotReady): self.check.run('dynamodb-create')
        self.db.describe_table.side_effect=RuntimeError('AccessDenied')
        with self.assertRaisesRegex(RuntimeError,'AccessDenied'): self.check.run('dynamodb-create')

    def test_empty_sqs_queue_alone_never_passes(self):
        self.cw.get_metric_statistics.return_value={'Datapoints':[]}
        with self.assertRaises(NotReady): self.check.run('sqs')
        self.cw.get_metric_statistics.side_effect=lambda **kw: {'Datapoints':[{'Sum':0 if kw['MetricName']=='NumberOfMessagesDeleted' else 1}]}
        with self.assertRaises(NotReady): self.check.run('sqs')
        self.cw.get_metric_statistics.side_effect=None
        self.cw.get_metric_statistics.return_value={'Datapoints':[{'Sum':1}]}
        self.assertEqual(self.check.run('sqs')['delete'],'recorded')
        for call in self.cw.get_metric_statistics.call_args_list:
            self.assertEqual(call.kwargs['Namespace'],'AWS/SQS')
            self.assertEqual(call.kwargs['Dimensions'],[{'Name':'QueueName','Value':'tc-team-handover'}])
        self.sqs.get_queue_url.assert_called_with(QueueName='tc-team-handover',QueueOwnerAWSAccountId='123456789012')

    def test_hidden_delayed_foreign_and_old_queue_cannot_pass(self):
        for changed in [{'ApproximateNumberOfMessages':'1'},{'ApproximateNumberOfMessagesNotVisible':'1'},{'ApproximateNumberOfMessagesDelayed':'1'},{'QueueArn':'other-team'},{'CreatedTimestamp':'0'},{'KmsMasterKeyId':'unwanted-key'},{'RedrivePolicy':'{}'}]:
            self.sqs.get_queue_attributes.return_value={'Attributes':{**self.attrs,**changed}}
            with self.assertRaises(NotReady): self.check.run('sqs')
        self.sqs.get_queue_attributes.side_effect=RuntimeError('AccessDenied')
        with self.assertRaisesRegex(RuntimeError,'AccessDenied'): self.check.run('sqs')

    def test_alarm_checks_target_and_rule_not_current_load(self):
        self.assertEqual(self.check.run('cpu-alarm')['trigger'],'not tested')
        for field,value in [('Dimensions',[{'Name':'InstanceId','Value':'i-other'}]),('Namespace','Other'),('MetricName','NetworkIn'),('Statistic','Maximum'),('Period',60),('Threshold',8),('ComparisonOperator','LessThanThreshold'),('EvaluationPeriods',3),('DatapointsToAlarm',2),('AlarmActions',['arn:action']),('OKActions',['arn:action']),('InsufficientDataActions',['arn:action'])]:
            self.cw.describe_alarms.return_value={'MetricAlarms':[{**self.alarm,field:value}]}
            with self.assertRaises(NotReady): self.check.run('cpu-alarm')
        self.cw.describe_alarms.return_value={'MetricAlarms':[]}
        with self.assertRaises(NotReady): self.check.run('cpu-alarm')

    def test_compiled_consumers_only_give_flag_after_all_real_checks(self):
        for slug,client in [('office-handover-record',self.db),('office-job-queue',None),('office-server-watch',self.cw)]:
            template=builder['template'](FAMILY.parents[1]/'challenges'/slug)
            app={};exec(compile(template['Resources']['Workshop']['Properties']['Code']['ZipFile'],'index.py','exec'),app)
            env={'PLAY_KEY':'p'*24,'PROGRESS_KEY':'r'*24,'FLAG_COMPLETION':'f'*24,'LAB_CONFIG':json.dumps(self.config)}
            def aws(_instance,name):return {'dynamodb':self.db,'sqs':self.sqs,'cloudwatch':self.cw}[name]
            token=''
            with patch.dict(os.environ,env),patch.object(app['AwsChecks'],'client',aws):
                for stage in range(2*len(app['CURRICULUM']['missions'])):
                    if slug=='office-handover-record' and stage==2:self.db.get_item.return_value['Item']['status']={'S':'done'}
                    result=app['handler']({'rawPath':'/'+'p'*24+'/api/check','requestContext':{'http':{'method':'POST'}},'body':json.dumps({'stage':stage,'token':token,'choice':'0'})})
                    self.assertEqual(result['statusCode'],200)
                    result=json.loads(result['body']);self.assertTrue(result['correct']);token=result['token']
                    if stage<2*len(app['CURRICULUM']['missions'])-1:self.assertNotIn('flag',result)
                self.assertEqual(result['flag'],'TC{'+'f'*24+'}')
            permissions=template['Resources']['ParticipantViewerRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
            for permission in permissions:
                actions=permission['Action']
                if any(a in actions for a in ['dynamodb:CreateTable','sqs:CreateQueue','cloudwatch:PutMetricAlarm']):
                    self.assertNotEqual(permission['Resource'],'*')
                self.assertFalse(any(a in actions for a in ['dynamodb:DeleteTable','dynamodb:UpdateTable','sqs:PurgeQueue','sqs:DeleteQueue','iam:PassRole','cloudwatch:SetAlarmState']))
                if 'cloudwatch:PutMetricAlarm' in actions:self.assertEqual(permission['Condition'],{'Null':{'cloudwatch:AlarmActions':'true'}})

    def test_created_resources_are_removed_by_fixed_name_and_errors_propagate(self):
        lifecycle['remove_created_resource'](self.db,{**self.config,'labKind':'dynamodb'})
        self.db.delete_table.assert_called_once_with(TableName='tc-team-handover')
        self.db.get_waiter.return_value.wait.assert_called_once_with(TableName='tc-team-handover',WaiterConfig={'Delay':5,'MaxAttempts':30})
        lifecycle['remove_created_resource'](self.sqs,{**self.config,'labKind':'sqs'})
        self.sqs.delete_queue.assert_called_once_with(QueueUrl=self.sqs.get_queue_url.return_value['QueueUrl'])
        lifecycle['remove_created_resource'](self.cw,{**self.config,'labKind':'cpu-alarm'})
        self.cw.delete_alarms.assert_called_once_with(AlarmNames=['tc-team-cpu'])
        self.db.delete_table.side_effect=RuntimeError('AccessDenied')
        with self.assertRaisesRegex(RuntimeError,'AccessDenied'):lifecycle['remove_created_resource'](self.db,{**self.config,'labKind':'dynamodb'})

if __name__=='__main__':unittest.main()
