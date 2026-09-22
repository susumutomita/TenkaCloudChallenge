"""S3 operation and cleanup evidence; real AWS requests use injected clients."""
import io
import json
import os
import runpy
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

FAMILY=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(FAMILY))
from checks import AwsChecks, NotReady
builder=runpy.run_path(str(FAMILY/'build.py'))
lifecycle=runpy.run_path(str(FAMILY/'service_lifecycle.py'))


class S3Test(unittest.TestCase):
    def setUp(self):
        self.config={'region':'ap-northeast-1','bucketName':'team-only','objectKey':'handover.txt','fileContent':'Office link: meeting room A\n','labKind':'s3-restore'}
        self.s3=Mock()
        self.s3.get_public_access_block.return_value={'PublicAccessBlockConfiguration':{key:True for key in ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets']}}
        self.s3.get_bucket_versioning.return_value={'Status':'Enabled'}
        self.s3.get_object.side_effect=lambda **_: {'Body':io.BytesIO(self.config['fileContent'].encode())}
        self.s3.list_object_versions.return_value={'Versions':[{'Key':'handover.txt','VersionId':str(i),'IsLatest':i==3} for i in [1,2,3]]}
        self.check=AwsChecks(self.config,{'s3':self.s3})

    def test_current_object_must_match_not_only_old_history(self):
        self.assertEqual(self.check.run('s3-restore')['currentVersion'],'restored')
        self.s3.get_object.assert_called_with(Bucket='team-only',Key='handover.txt')
        self.s3.get_object.side_effect=lambda **_: {'Body':io.BytesIO(b'Office link: WRONG ROOM\n')}
        with self.assertRaises(NotReady): self.check.run('s3-restore')

    def test_text_editor_line_endings_do_not_make_a_correct_note_wrong(self):
        for content in [b'Office link: meeting room A',b'Office link: meeting room A\r\n',b'\xef\xbb\xbfOffice link: meeting room A\n']:
            self.s3.get_object.side_effect=lambda **_: {'Body':io.BytesIO(content)}
            self.assertEqual(self.check.run('s3-save')['content'],'verified')

    def test_restoration_preserves_versioning_and_history(self):
        self.s3.list_object_versions.return_value={'Versions':[{'Key':'handover.txt','VersionId':'1','IsLatest':True}]}
        with self.assertRaises(NotReady): self.check.run('s3-restore')
        self.s3.get_bucket_versioning.return_value={'Status':'Suspended'}
        with self.assertRaises(NotReady): self.check.run('s3-restore')

    def test_public_access_and_aws_errors_do_not_pass(self):
        self.s3.get_public_access_block.return_value['PublicAccessBlockConfiguration']['BlockPublicPolicy']=False
        with self.assertRaises(NotReady): self.check.run('s3-save')
        self.s3.get_public_access_block.side_effect=RuntimeError('AccessDenied')
        with self.assertRaisesRegex(RuntimeError,'AccessDenied'): self.check.run('s3-save')

    def test_teardown_removes_versions_and_markers_and_reports_errors(self):
        self.s3.list_object_versions.side_effect=[{'Versions':[{'Key':'handover.txt','VersionId':'good'}],'DeleteMarkers':[{'Key':'handover.txt','VersionId':'deleted'}]},{}]
        self.s3.delete_objects.return_value={}
        lifecycle['execute']({'RequestType':'Delete'},self.s3,self.config)
        self.s3.delete_objects.assert_called_with(Bucket='team-only',Delete={'Objects':[{'Key':'handover.txt','VersionId':'good'},{'Key':'handover.txt','VersionId':'deleted'}],'Quiet':True})
        self.s3.list_object_versions.side_effect=None
        self.s3.list_object_versions.return_value={'Versions':[{'Key':'handover.txt','VersionId':'good'}]}
        self.s3.delete_objects.return_value={'Errors':[{'Code':'AccessDenied'}]}
        with self.assertRaisesRegex(RuntimeError,'cleanup failed'): lifecycle['execute']({'RequestType':'Delete'},self.s3,self.config)

    def test_both_consumers_use_real_checks_and_one_final_flag(self):
        for slug in ['office-file-delivery','office-file-recovery']:
            problem=FAMILY.parents[1]/'challenges'/slug
            template=builder['template'](problem)
            code=template['Resources']['Workshop']['Properties']['Code']['ZipFile']
            app={};exec(compile(code,'index.py','exec'),app)
            env={'PLAY_KEY':'p'*24,'PROGRESS_KEY':'r'*24,'FLAG_COMPLETION':'f'*24,'LAB_CONFIG':json.dumps(self.config)}
            def request(route,body):
                result=app['handler']({'rawPath':'/'+'p'*24+'/'+route,'requestContext':{'http':{'method':'POST'}},'body':json.dumps(body)})
                self.assertEqual(result['statusCode'],200);return json.loads(result['body'])
            with patch.dict(os.environ,env),patch.object(app['AwsChecks'],'client',return_value=self.s3):
                initial=request('api/state',{'token':''});self.assertNotIn('flag',initial)
                result=request('api/check',{'stage':0,'token':''});self.assertTrue(result['correct']);self.assertNotIn('flag',result)
                done=request('api/check',{'stage':1,'token':result['token'],'choice':str(app['CURRICULUM']['missions'][0]['correctChoice'])})
                self.assertEqual(done['flag'],'TC{'+'f'*24+'}')
            role=json.dumps(template['Resources']['ParticipantViewerRole'])
            for forbidden in ['s3:DeleteObject','s3:PutBucketPolicy','lambda:GetFunction','s3:*']:
                self.assertNotIn(forbidden,role)
            self.assertEqual(template['Resources']['Bucket']['Properties']['BucketEncryption']['ServerSideEncryptionConfiguration'][0]['ServerSideEncryptionByDefault'],{'SSEAlgorithm':'AES256'})


if __name__=='__main__': unittest.main()
