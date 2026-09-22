"""Seed/remove only the configured exercise resources (CFN-only Lambda)."""
import json
import os
import urllib.request


def execute(event, s3, config):
    bucket = config['bucketName']
    if event['RequestType'] == 'Create' and config['labKind'] == 's3-restore':
        # Exact content is public teaching material, never a flag or credential.
        # CFN retries replace the current fixture predictably; learners begin
        # only after the deployment completes.
        s3.put_object(Bucket=bucket, Key=config['objectKey'], Body=config['fileContent'].encode(), ContentType='text/plain; charset=utf-8')
        s3.put_object(Bucket=bucket, Key=config['objectKey'], Body=b'Office link: WRONG ROOM\n', ContentType='text/plain; charset=utf-8')
    if event['RequestType'] == 'Delete':
        while True:
            # Always delete the first page: no stale pagination marker after a
            # deletion, and delete markers count as objects to remove too.
            response=s3.list_object_versions(Bucket=bucket, MaxKeys=1000)
            objects=[{'Key':v['Key'],'VersionId':v['VersionId']} for key in ['Versions','DeleteMarkers'] for v in response.get(key,[])]
            if not objects: break
            result=s3.delete_objects(Bucket=bucket, Delete={'Objects':objects,'Quiet':True})
            if result.get('Errors'): raise RuntimeError('S3 object cleanup failed')


def remove_created_resource(client, config):
    """The participant can create one fixed name; only this role can delete it."""
    kind=config['labKind']
    try:
        if kind=='dynamodb':
            table=client.describe_table(TableName=config['tableName'])['Table']
            if table.get('DeletionProtectionEnabled'):
                client.update_table(TableName=config['tableName'],DeletionProtectionEnabled=False)
                client.get_waiter('table_exists').wait(TableName=config['tableName'],WaiterConfig={'Delay':2,'MaxAttempts':20})
            client.delete_table(TableName=config['tableName'])
            client.get_waiter('table_not_exists').wait(TableName=config['tableName'],WaiterConfig={'Delay':5,'MaxAttempts':30})
        elif kind=='sqs':
            url=client.get_queue_url(QueueName=config['queueName'],QueueOwnerAWSAccountId=config['accountId'])['QueueUrl']
            client.delete_queue(QueueUrl=url)
        elif kind=='cpu-alarm':
            client.delete_alarms(AlarmNames=[config['alarmName']])
        else: raise ValueError('Unsupported lifecycle kind')
    except Exception as error:
        code=getattr(error,'response',{}).get('Error',{}).get('Code')
        absent={'dynamodb':('ResourceNotFoundException',),'sqs':('AWS.SimpleQueueService.NonExistentQueue','QueueDoesNotExist'),'cpu-alarm':()}
        if code not in absent.get(kind,()): raise


def handler(event, context):
    import boto3
    config=json.loads(os.environ['LAB_CONFIG'])
    status, reason='SUCCESS', 'Exercise data lifecycle completed'
    try:
        from botocore.config import Config
        service={'dynamodb':'dynamodb','sqs':'sqs','cpu-alarm':'cloudwatch'}.get(config['labKind'],'s3')
        client=boto3.client(service,region_name=config['region'],config=Config(connect_timeout=3,read_timeout=5,retries={'max_attempts':1}))
        if service=='s3': execute(event,client,config)
        elif event['RequestType']=='Delete': remove_created_resource(client,config)
    except Exception as error:
        code=getattr(error,'response',{}).get('Error',{}).get('Code',type(error).__name__)
        # Only confirmed absence during teardown is already complete.
        if not (event['RequestType']=='Delete' and code=='NoSuchBucket'):
            status,reason='FAILED','Exercise data lifecycle failed: '+code
    body=json.dumps({'Status':status,'Reason':reason,'PhysicalResourceId':event.get('PhysicalResourceId',event['LogicalResourceId']),
        'StackId':event['StackId'],'RequestId':event['RequestId'],'LogicalResourceId':event['LogicalResourceId'],'Data':{}}).encode()
    request=urllib.request.Request(event['ResponseURL'],data=body,method='PUT',headers={'Content-Type':'','Content-Length':str(len(body))})
    with urllib.request.urlopen(request,timeout=10) as result:
        if result.status != 200: raise RuntimeError('CloudFormation response failed')
