import copy
import json
import os
import runpy
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

ROOT=Path(__file__).resolve().parents[1]
FAMILY=ROOT.parents[1]/'runtimes'/'aws-intro'
sys.path.insert(0,str(FAMILY))
builder=runpy.run_path(str(ROOT/'build.py'))
code=builder['compile_code']();app={};exec(compile(code,'index.py','exec'),app)

class MemoryStore:
    def __init__(self):self.state={'revision':0,'index':0,'phase':'idle'}
    def read(self):return copy.deepcopy(self.state)
    def save(self,old,new):
        if old['revision']!=self.state['revision']:raise app['Conflict']('Changed')
        self.state={**new,'revision':old['revision']+1};return self.read()

class BattleTest(unittest.TestCase):
    def setUp(self):
        self.fixture=runpy.run_path(str(FAMILY/'tests'/'test_checks.py'))['AwsChecksTest']();self.fixture.setUp()
        self.fixture.config.update(gatewayId='igw-lab',stateTable='round-state',serverName='tc-office-team1-server',publicIp='8.8.8.8',instanceProfileName='tc-office-team1-session')
        self.fixture.ec2.describe_addresses.return_value={'Addresses':[{'PublicIp':'8.8.8.8','NetworkInterfaceId':'eni-lab','AssociationId':'eipassoc-own'}]}
        self.fixture.ec2.describe_iam_instance_profile_associations.return_value={'IamInstanceProfileAssociations':[{'AssociationId':'profile-own','State':'associated','IamInstanceProfile':{'Arn':self.fixture.config['instanceProfileArn']}}]}
        self.store=MemoryStore();self.now=1000
        checks=app['AwsChecks'](self.fixture.config,{'ec2':self.fixture.ec2,'ssm':self.fixture.ssm},self.fixture.fetch)
        self.engine=app['Battle'](checks,self.store,lambda:self.now)

    def test_health_uses_real_http_network_and_management_role(self):
        self.assertEqual(self.engine.health()['http'],200)
        self.fixture.fetch.side_effect=app['NotReady']('unreachable')
        with self.assertRaises(app['NotReady']):self.engine.health()
        self.fixture.fetch.side_effect=None;self.fixture.fetch.return_value=self.fixture.response
        del self.fixture.instance['IamInstanceProfile']
        with self.assertRaises(app['NotReady']):self.engine.health()

    def test_four_faults_are_serial_and_require_review(self):
        for kind in app['KINDS']:
            active=self.engine.start(kind)
            self.assertEqual(active['phase'],'active')
            with self.assertRaises(app['Conflict']):self.engine.start(kind)
            with self.assertRaises(app['Conflict']):self.engine.explain('0')
            if kind == 'role':
                self.record_session(self.now + 1)
            reviewed=self.engine.verify();self.assertEqual(reviewed['recoveredBy'],'team')
            with self.assertRaises(app['Conflict']):self.engine.start(kind)
            self.assertFalse(self.engine.explain('1'));self.assertEqual(self.store.read()['phase'],'review')
            self.assertTrue(self.engine.explain('0'))
        self.assertEqual(self.store.read()['index'],4)
        with self.assertRaises(app['Conflict']):self.engine.start('gateway')

    def record_session(self, started):
        self.fixture.response['sessionCommandAt'] = started
        self.fixture.ssm.describe_sessions.return_value = {'Sessions': [{
            'Target': 'i-lab',
            'Owner': 'arn:aws:sts::123456789012:assumed-role/lab-student/browser',
            'StartDate': datetime.fromtimestamp(started, timezone.utc),
        }]}

    def test_role_recovery_requires_new_session_and_new_command(self):
        self.store.state.update(index=2)
        self.engine.start('role')
        self.record_session(self.now - 10)
        with self.assertRaises(app['NotReady']): self.engine.verify()
        self.fixture.response['sessionCommandAt'] = self.now + 1
        with self.assertRaises(app['NotReady']): self.engine.verify()
        self.record_session(self.now + 1)
        self.assertEqual(self.engine.verify()['phase'], 'review')

    def test_state_store_uses_conditional_writes_and_propagates_service_errors(self):
        from botocore.exceptions import ClientError
        client = Mock()
        client.get_item.return_value = {}
        store = app['StateStore'](client, 'own-table')
        initial = store.read()
        client.get_item.assert_called_once_with(TableName='own-table', Key={'id': {'S':'round'}}, ConsistentRead=True)
        first = store.save(initial, {**initial, 'phase': 'applying'})
        self.assertEqual(client.put_item.call_args.kwargs['ConditionExpression'], 'attribute_not_exists(id)')
        store.save(first, {**first, 'phase': 'active'})
        self.assertEqual(client.put_item.call_args.kwargs['ExpressionAttributeValues'], {':revision': {'N': '1'}})
        client.put_item.side_effect = ClientError({'Error': {'Code': 'ConditionalCheckFailedException'}}, 'PutItem')
        with self.assertRaises(app['Conflict']): store.save(first, first)
        client.put_item.side_effect = ClientError({'Error': {'Code': 'AccessDeniedException'}}, 'PutItem')
        with self.assertRaises(ClientError): store.save(first, first)

    def test_gateway_disassociates_before_detaching_and_never_steals(self):
        calls=self.fixture.ec2
        self.engine.start('gateway')
        relevant=[c[0] for c in calls.mock_calls if c[0] in ('disassociate_address','detach_internet_gateway')]
        self.assertEqual(relevant,['disassociate_address','detach_internet_gateway'])
        calls.detach_internet_gateway.assert_called_once_with(InternetGatewayId='igw-lab',VpcId='vpc-lab')
        self.fixture.ec2.describe_addresses.return_value['Addresses'][0]['NetworkInterfaceId']='eni-other'
        with self.assertRaises(ValueError):self.engine.apply('gateway')
        calls.disassociate_address.assert_called_once()

    def test_apply_failure_keeps_visible_recovery_state(self):
        self.fixture.ec2.detach_internet_gateway.side_effect=RuntimeError('DependencyViolation')
        with self.assertRaisesRegex(RuntimeError,'DependencyViolation'):self.engine.start('gateway')
        self.assertEqual(self.store.read()['phase'],'restoring')
        with self.assertRaises(app['Conflict']):self.engine.start('route')
        self.fixture.ec2.detach_internet_gateway.side_effect=None
        self.assertEqual(self.engine.recover()['phase'],'review')

    def test_timer_waits_for_deadline_and_serializes_retry(self):
        self.engine.start('gateway');self.now=1599
        self.assertEqual(self.engine.recover()['phase'],'active')
        self.now=1601
        self.fixture.ec2.describe_internet_gateways.side_effect=RuntimeError('AccessDenied')
        with self.assertRaisesRegex(RuntimeError,'AccessDenied'):self.engine.recover()
        state=self.store.read();self.assertEqual(state['phase'],'restoring')
        self.assertEqual(state['recoverAfter'],1781)
        self.assertEqual(self.engine.recover(force=True),state)
        self.fixture.ec2.describe_internet_gateways.side_effect=None
        self.now=1782
        self.assertEqual(self.engine.recover()['recoveredBy'],'watchdog')

    def test_restore_operations_only_touch_configured_resources(self):
        ec2=self.fixture.ec2
        self.fixture.gateway['Attachments']=[]
        ec2.attach_internet_gateway.side_effect=lambda **kwargs:self.fixture.gateway.update(Attachments=[{'VpcId':kwargs['VpcId'],'State':'available'}])
        self.engine.restore('gateway')
        ec2.attach_internet_gateway.assert_called_once_with(InternetGatewayId='igw-lab',VpcId='vpc-lab')
        self.fixture.table['Routes']=[];self.engine.restore('route')
        ec2.create_route.assert_called_once_with(RouteTableId='rtb-lab',DestinationCidrBlock='0.0.0.0/0',GatewayId='igw-lab')
        ec2.describe_iam_instance_profile_associations.return_value={'IamInstanceProfileAssociations':[]};self.engine.restore('role')
        ec2.associate_iam_instance_profile.assert_called_once_with(InstanceId='i-lab',IamInstanceProfile={'Arn':self.fixture.config['instanceProfileArn']})
        self.engine.restore('http')
        self.assertTrue(all(call.kwargs['GroupId']=='sg-lab' for call in ec2.authorize_security_group_ingress.call_args_list))

    def test_public_handlers_reject_operator_actions_and_stale_posts(self):
        def request(route,body=None):
            event={'rawPath':'/'+'p'*24+'/'+route,'requestContext':{'http':{'method':'POST' if body is not None else 'GET'}}}
            if body is not None:event['body']=json.dumps(body)
            return app['handler'](event)
        with patch.dict(os.environ,{'PLAY_KEY':'p'*24}),patch.dict(app,{'battle':lambda:self.engine}):
            self.assertEqual(request('api/start',{})['statusCode'],405)
            initial=request('api/state');self.assertNotIn('correctChoice',initial['body']);self.assertNotIn('hints',initial['body'])
            self.assertEqual(request('health')['statusCode'],200)
            self.engine.start('gateway')
            self.assertEqual(request('api/check',{'revision':0})['statusCode'],409)
            current=json.loads(request('api/state')['body']);self.assertNotIn('correctChoice',json.dumps(current))
            for language in ['ja','en']:
                for round_info in app['ROUNDS']:
                    self.assertEqual(len(set(round_info['explanationHints'][language])),3)
                    self.assertNotEqual(round_info['hints'][language],round_info['explanationHints'][language])
            self.assertEqual(request('api/check',{'revision':current['revision']})['statusCode'],200)
            self.fixture.fetch.side_effect=app['NotReady']('Unreachable')
            self.assertEqual(request('health')['statusCode'],503)

    def test_template_preserves_scoring_boundary_and_cleanup_order(self):
        t=builder['template']();r=t['Resources']
        self.assertEqual(t['Outputs']['HealthUrl']['Value'],'')
        self.assertNotIn('CompletionFlag',t['Outputs'])
        self.assertNotIn('FaultUrl',r)
        self.assertEqual(r['FaultController']['Properties']['Handler'],'index.operator_handler')
        self.assertEqual(r['Watchdog']['DependsOn'],'CleanupHook')
        self.assertEqual(r['WorkshopUrl']['DependsOn'],'CleanupHook')
        role=json.dumps(r['ParticipantViewerRole'])
        for forbidden in ['ec2:RunInstances','ec2:CreateInternetGateway','dynamodb:','lambda:Invoke','ec2:DetachInternetGateway']:
            self.assertNotIn(forbidden,role)
        for fn in ['Workshop','FaultController']:
            self.assertEqual(r[fn]['Properties']['Code']['ZipFile'],code)
        trust=r['ParticipantViewerRole']['Properties']['AssumeRolePolicyDocument']['Statement'][0]
        self.assertIn('sts:ExternalId',trust['Condition']['StringEquals'])

if __name__=='__main__':unittest.main()
