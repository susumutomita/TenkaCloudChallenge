"""Service exercises sharing the workshop's AWS client and progress protocol."""

import json
import re
from datetime import datetime, timedelta, timezone
from check_errors import NotReady, require


class ServiceChecks:
    def dynamodb_item(self, status):
        db=self.client('dynamodb')
        try:
            table=db.describe_table(TableName=self.config['tableName'])['Table']
        except Exception as error:
            if getattr(error,'response',{}).get('Error',{}).get('Code')=='ResourceNotFoundException':
                raise NotReady('Create the named DynamoDB table first') from error
            raise
        require(table.get('TableStatus')=='ACTIVE', 'Wait until the DynamoDB table is active')
        require(table.get('KeySchema')==[{'AttributeName':'recordId','KeyType':'HASH'}] and table.get('AttributeDefinitions')==[{'AttributeName':'recordId','AttributeType':'S'}], 'Use recordId as the string partition key without a sort key')
        require(table.get('BillingModeSummary',{}).get('BillingMode')=='PAY_PER_REQUEST', 'Use on-demand capacity for this table')
        require(not table.get('GlobalSecondaryIndexes') and not table.get('LocalSecondaryIndexes'), 'This exercise needs no extra indexes')
        item=db.get_item(TableName=self.config['tableName'],Key={'recordId':{'S':'handover'}},ConsistentRead=True).get('Item',{})
        require(item.get('destination')=={'S':'YOKOHAMA'} and item.get('status')=={'S':status}, 'Find handover and check its destination and status')
        return {'recordId':'handover','status':status,'read':'consistent'}

    def sqs_delivery(self):
        sqs=self.client('sqs')
        try:
            url=sqs.get_queue_url(QueueName=self.config['queueName'],QueueOwnerAWSAccountId=self.config['accountId'])['QueueUrl']
        except Exception as error:
            if getattr(error,'response',{}).get('Error',{}).get('Code') in ('AWS.SimpleQueueService.NonExistentQueue','QueueDoesNotExist'):
                raise NotReady('Create the named Standard queue first') from error
            raise
        attrs=sqs.get_queue_attributes(QueueUrl=url,AttributeNames=['All'])['Attributes']
        require(attrs.get('QueueArn')==self.config['queueArn'], 'Use the queue assigned to this team')
        require(attrs.get('FifoQueue','false')=='false' and attrs.get('DelaySeconds')=='0' and attrs.get('MessageRetentionPeriod')=='345600' and attrs.get('VisibilityTimeout')=='30' and not attrs.get('RedrivePolicy'), 'Use Standard queue defaults: no delay, four-day retention, thirty-second visibility')
        require(attrs.get('SqsManagedSseEnabled')=='true' and not attrs.get('KmsMasterKeyId'), 'Use SQS-managed encryption for this queue')
        created=datetime.fromtimestamp(int(attrs['CreatedTimestamp']),timezone.utc)
        now=datetime.now(timezone.utc)
        require(timedelta(0) <= now-created < timedelta(hours=6), 'Use this event queue within six hours of creation')
        counts={}
        for name in ['NumberOfMessagesSent','NumberOfMessagesReceived','NumberOfMessagesDeleted']:
            metric=self.client('cloudwatch').get_metric_statistics(Namespace='AWS/SQS',MetricName=name,
                Dimensions=[{'Name':'QueueName','Value':self.config['queueName']}],StartTime=created,EndTime=now+timedelta(minutes=1),Period=60,Statistics=['Sum'])
            counts[name]=sum(point.get('Sum',0) for point in metric.get('Datapoints',[]))
        # Counts can include retries. We require evidence of each operation,
        # not a unique-message count; emptiness alone can never complete.
        require(all(count>0 for count in counts.values()), 'Wait for AWS to record send, receive, and delete operations; then check again')
        require(all(attrs.get(name)=='0' for name in ['ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible','ApproximateNumberOfMessagesDelayed']), 'Finish deleting received messages; receiving alone only hides them temporarily')
        return {'send':'recorded','receive':'recorded','delete':'recorded','queue':'empty'}

    def cpu_alarm(self):
        result=self.client('cloudwatch').describe_alarms(AlarmNames=[self.config['alarmName']],AlarmTypes=['MetricAlarm'])
        alarms=result.get('MetricAlarms',[])
        require(len(alarms)==1, 'Create the named CPU alarm first')
        alarm=alarms[0]
        require(alarm.get('Namespace')=='AWS/EC2' and alarm.get('MetricName')=='CPUUtilization' and alarm.get('Dimensions')==[{'Name':'InstanceId','Value':self.config['instanceId']}], 'Select CPUUtilization for the prepared EC2 instance')
        require(alarm.get('Statistic')=='Average' and alarm.get('Period')==300 and alarm.get('EvaluationPeriods')==1 and alarm.get('DatapointsToAlarm',1)==1 and alarm.get('ComparisonOperator')=='GreaterThanThreshold' and alarm.get('Threshold')==80, 'Use average over five minutes, greater than eighty, with one evaluation')
        require(not any(alarm.get(name) for name in ['AlarmActions','OKActions','InsufficientDataActions','Metrics']) and not alarm.get('ExtendedStatistic'), 'Create a simple metric alarm without notification or recovery actions')
        return {'instanceId':self.config['instanceId'],'alarm':'configured','trigger':'not tested'}

    def s3_object(self):
        s3 = self.client('s3')
        name = self.config['bucketName']
        block = s3.get_public_access_block(Bucket=name)['PublicAccessBlockConfiguration']
        require(all(block.get(key) is True for key in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']), 'Keep all four S3 public access blocks enabled')
        try:
            result = s3.get_object(Bucket=name, Key=self.config['objectKey'])
        except Exception as error:
            if getattr(error,'response',{}).get('Error',{}).get('Code') in ('NoSuchKey','NoSuchVersion'):
                raise NotReady('The team file is not saved at the requested key yet') from error
            raise
        with result['Body'] as body:
            data = body.read(8193)
        try:
            content=data.decode('utf-8-sig').replace('\r\n','\n').rstrip('\n')
        except UnicodeError as error:
            raise NotReady('The current file content differs from the team handover note') from error
        require(content == self.config['fileContent'].rstrip('\n'), 'The current file content differs from the team handover note')
        return {'bucket':name, 'key':self.config['objectKey'], 'content':'verified'}

    def s3_restore(self):
        s3 = self.client('s3')
        name = self.config['bucketName']
        require(s3.get_bucket_versioning(Bucket=name).get('Status') == 'Enabled', 'Keep S3 versioning enabled')
        result = self.s3_object()
        versions = s3.list_object_versions(Bucket=name, Prefix=self.config['objectKey'], MaxKeys=1000)
        matching = [v for v in versions.get('Versions',[]) if v['Key']==self.config['objectKey']]
        require(len(matching) >= 3 and any(v.get('IsLatest') for v in matching), 'Restore the earlier content as a new current version')
        # Listing a healthy old version alone cannot pass: s3_object reads the
        # current object without VersionId. Participants cannot delete history.
        return {**result, 'versions':'preserved', 'currentVersion':'restored'}

    def lambda_record(self, inputs, include_destination=False):
        receipt=inputs.get('receipt','')
        require(isinstance(receipt,str) and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',receipt) is not None, 'Copy the receipt from your Lambda execution result')
        logs=self.client('logs')
        request={'logGroupName':self.config['studentLogGroup'],'filterPattern':'"'+receipt+'"','limit':100}
        previous=None
        while True:
            response=logs.filter_log_events(**request)
            for event in response.get('events',[]):
                try: record=json.loads(event['message'])
                except (ValueError,UnicodeError): continue  # Other runtime log lines are not our receipt.
                if not isinstance(record,dict): continue
                if record.get('receipt')!=receipt or record.get('team')!=self.config['namePrefix'] or record.get('parcels')!=3:
                    continue
                if include_destination:
                    require(inputs.get('destination','').strip()==record.get('destination'), 'Read the destination in the log for this receipt')
                return {'receipt':receipt,'execution':'verified','log':'verified' if include_destination else 'recorded'}
            token=response.get('nextToken')
            if not token or token==previous: break
            previous=token;request['nextToken']=token
        raise NotReady('The execution receipt is not in this function log yet')
