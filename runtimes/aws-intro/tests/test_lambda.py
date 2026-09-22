"""Evidence must come from the team function, not an untrusted pasted receipt."""
import contextlib
import io
import json
import os
import runpy
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

FAMILY=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(FAMILY))
from checks import AwsChecks, NotReady
builder=runpy.run_path(str(FAMILY/'build.py'))
student=runpy.run_path(str(FAMILY/'student_lambda.py'))
RECEIPT='12345678-1234-1234-1234-123456789012'

class LambdaTest(unittest.TestCase):
    def setUp(self):
        self.config={'namePrefix':'tc-team-one','studentLogGroup':'student-only','region':'ap-northeast-1'}
        self.record={'receipt':RECEIPT,'team':'tc-team-one','parcels':3,'destination':'SHIZUOKA'}
        self.logs=Mock()
        self.logs.filter_log_events.return_value={'events':[{'message':json.dumps(self.record)}]}
        self.check=AwsChecks(self.config,{'logs':self.logs})

    def test_student_function_records_only_accepted_input(self):
        for data,accepted in [({'team':'tc-team-one','parcels':3},True),({'team':'other','parcels':3},False),({'team':'tc-team-one','parcels':True},False),({'team':'tc-team-one','parcels':4},False)]:
            output=io.StringIO()
            with patch.dict(os.environ,{'TEAM_NAME':'tc-team-one'}),contextlib.redirect_stdout(output):
                result=student['handler'](data,types.SimpleNamespace(aws_request_id=RECEIPT))
            self.assertEqual(result['accepted'],accepted)
            if accepted:
                self.assertEqual(json.loads(output.getvalue()),self.record)
                self.assertNotIn('destination',result)
            else: self.assertEqual(output.getvalue(),'')

    def test_forged_or_other_team_receipt_cannot_pass(self):
        with self.assertRaises(NotReady): self.check.run('lambda-run',{'receipt':'made-up'})
        self.logs.filter_log_events.assert_not_called()
        self.logs.filter_log_events.return_value={'events':[]}
        with self.assertRaises(NotReady): self.check.run('lambda-run',{'receipt':RECEIPT})
        for changed in [{'team':'other'},{'receipt':'87654321-1234-1234-1234-123456789012'},{'parcels':4}]:
            self.logs.filter_log_events.return_value={'events':[{'message':json.dumps({**self.record,**changed})}]}
            with self.assertRaises(NotReady): self.check.run('lambda-run',{'receipt':RECEIPT})

    def test_log_investigation_requires_matching_destination(self):
        self.assertEqual(self.check.run('lambda-run',{'receipt':RECEIPT})['execution'],'verified')
        with self.assertRaises(NotReady): self.check.run('lambda-logs',{'receipt':RECEIPT,'destination':'YOKOHAMA'})
        self.assertEqual(self.check.run('lambda-logs',{'receipt':RECEIPT,'destination':'SHIZUOKA'})['log'],'verified')
        self.logs.filter_log_events.assert_called_with(logGroupName='student-only',filterPattern='"'+RECEIPT+'"',limit=100)

    def test_pagination_and_operational_errors(self):
        self.logs.filter_log_events.side_effect=[{'events':[{'message':'START RequestId: '+RECEIPT}],'nextToken':'page2'}, {'events':[{'message':json.dumps(self.record)}]}]
        self.assertEqual(self.check.run('lambda-run',{'receipt':RECEIPT})['execution'],'verified')
        self.assertEqual(self.logs.filter_log_events.call_args.kwargs['nextToken'],'page2')
        self.logs.filter_log_events.side_effect=RuntimeError('AccessDenied')
        with self.assertRaisesRegex(RuntimeError,'AccessDenied'): self.check.run('lambda-run',{'receipt':RECEIPT})

    def test_compiled_consumers_isolate_student_permissions_and_grade_both_stages(self):
        for slug in ['office-lambda-delivery','office-log-investigation']:
            template=builder['template'](FAMILY.parents[1]/'challenges'/slug)
            app={};exec(compile(template['Resources']['Workshop']['Properties']['Code']['ZipFile'],'index.py','exec'),app)
            env={'PLAY_KEY':'p'*24,'PROGRESS_KEY':'r'*24,'FLAG_COMPLETION':'f'*24,'LAB_CONFIG':json.dumps(self.config)}
            def request(data):
                result=app['handler']({'rawPath':'/'+'p'*24+'/api/check','requestContext':{'http':{'method':'POST'}},'body':json.dumps(data)})
                return result['statusCode'],json.loads(result['body'])
            with patch.dict(os.environ,env),patch.object(app['AwsChecks'],'client',return_value=self.logs):
                self.assertEqual(request({'stage':0,'inputs':['bad']})[0],400)
                self.assertEqual(request({'stage':0,'inputs':{'receipt':True}})[0],400)
                status,checked=request({'stage':0,'inputs':{'receipt':RECEIPT,'destination':'SHIZUOKA'}})
                self.assertEqual(status,200);self.assertTrue(checked['correct']);self.assertNotIn('flag',checked)
                status,done=request({'stage':1,'token':checked['token'],'choice':'0'})
                self.assertEqual(done['flag'],'TC{'+'f'*24+'}')
            role=template['Resources']['ParticipantViewerRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
            for statement in role:
                if any(action.startswith('lambda:') for action in statement['Action']):
                    self.assertEqual(statement['Resource'],{'Fn::GetAtt':['StudentFunction','Arn']})
            self.assertEqual(set(template['Resources']['StudentFunction']['Properties']['Environment']['Variables']),{'TEAM_NAME'})
            self.assertNotIn('DataLifecycle',template['Resources'])

if __name__=='__main__': unittest.main()
