"""Boundary checks for the generated CloudFormation artifact."""
import ast
import json
import runpy
import unittest
from pathlib import Path

FAMILY = Path(__file__).resolve().parents[1]
PROBLEM = FAMILY.parents[1]/'challenges'/'office-link-gate'
builder = runpy.run_path(str(FAMILY/'build.py'))


class TemplateTest(unittest.TestCase):
    def test_each_checkpoint_has_its_own_bilingual_hint_staircase(self):
        # A repair hint is not useful for the explanation that follows it.
        files = list((FAMILY.parents[1]/'challenges').glob('office-*/workshop.json'))
        self.assertEqual(len(files), 8)
        for path in files:
            for mission in json.loads(path.read_text())['missions']:
                for language in ['ja', 'en']:
                    with self.subTest(problem=path.parent.name, mission=mission['check'], language=language):
                        action = mission['hints'][language]
                        explanation = mission['explanationHints'][language]
                        self.assertEqual(len(action), 3)
                        self.assertEqual(len(set(explanation)), 3)
                        self.assertTrue(all(explanation))
                        self.assertNotEqual(action, explanation)

    def test_one_fixed_network_interface_bounds_student_launch(self):
        template=builder['template'](PROBLEM)
        r=template['Resources']
        self.assertFalse(any(v['Type']=='AWS::EC2::Instance' for v in r.values()))
        launch=r['LaunchTemplate']['Properties']['LaunchTemplateData']
        self.assertEqual(launch['NetworkInterfaces'], [{'NetworkInterfaceId':{'Ref':'LabNic'}, 'DeviceIndex':0, 'DeleteOnTermination':False}])
        self.assertEqual(launch['InstanceType'],'t3.micro')
        self.assertNotIn('IamInstanceProfile',launch)
        policy=r['ParticipantViewerRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
        for stmt in policy:
            self.assertNotIn('AdministratorAccess',json.dumps(stmt))
            self.assertNotIn('ec2:*',stmt['Action'])
            if 'ec2:RunInstances' in stmt['Action'] and 'volume/*' in json.dumps(stmt['Resource']):
                self.assertEqual(stmt['Condition']['NumericLessThanEquals']['ec2:VolumeSize'],'8')
                self.assertNotIn('ec2:InstanceType',stmt['Condition']['StringEquals'])
        trust=r['ParticipantViewerRole']['Properties']['AssumeRolePolicyDocument']['Statement'][0]
        self.assertIn('sts:ExternalId',trust['Condition']['StringEquals'])
        # Ending/resuming another participant's session must not be permitted.
        session = next(stmt for stmt in policy if 'ssm:TerminateSession' in stmt['Action'])
        self.assertTrue(session['Resource']['Fn::Sub'].endswith('session/${!aws:userid}-*'))
        self.assertNotIn('Condition', session)

    def test_eip_uses_allocation_id_for_mutations_and_public_ip_for_display(self):
        r=builder['template'](PROBLEM)['Resources']
        config=json.loads(r['Workshop']['Properties']['Environment']['Variables']['LAB_CONFIG']['Fn::Sub'])
        self.assertEqual(config['allocationId'],'${LabAddress.AllocationId}')
        self.assertEqual(config['publicIp'],'${LabAddress}')
        policies=json.dumps(r['WorkshopRole'])
        self.assertIn('elastic-ip/${LabAddress.AllocationId}',policies)
        self.assertNotIn('elastic-ip/${LabAddress}',policies)
        self.assertEqual(r['CleanupHook']['Properties']['ServiceToken'],{'Fn::GetAtt':['Cleanup','Arn']})
        self.assertNotIn('CleanupUrl',r)
        self.assertTrue(r['UrlInvocation']['Properties']['InvokedViaFunctionUrl'])

    def test_only_cleanup_can_remove_termination_protection_on_owned_instances(self):
        r=builder['template'](PROBLEM)['Resources']
        cleanup=r['CleanupRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
        statement=next(s for s in cleanup if 'ec2:ModifyInstanceAttribute' in s['Action'])
        self.assertNotEqual(statement['Resource'],'*')
        self.assertEqual(statement['Condition']['StringEquals']['ec2:Attribute'],'disableApiTermination')
        self.assertEqual(statement['Condition']['StringEquals']['aws:ResourceTag/TenkaCloud:NamePrefix'],{'Ref':'NamePrefix'})
        participant=r['ParticipantViewerRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
        self.assertFalse(any('ec2:ModifyInstanceAttribute' in s['Action'] for s in participant))

    def test_all_observations_have_japanese_text(self):
        tree=ast.parse((FAMILY/'checks.py').read_text()+'\n'+(FAMILY/'service_checks.py').read_text())
        messages=[]
        for node in ast.walk(tree):
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Name):
                arg=node.args[1] if node.func.id=='require' else node.args[0] if node.func.id=='NotReady' and node.args else None
                if isinstance(arg,ast.Constant) and isinstance(arg.value,str): messages.append(arg.value)
        translations=json.loads((FAMILY/'observations.json').read_text())
        for message in messages:
            with self.subTest(message=message): self.assertTrue(translations[message])


if __name__=='__main__': unittest.main()
