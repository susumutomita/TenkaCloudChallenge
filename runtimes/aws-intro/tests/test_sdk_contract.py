"""AWS SDK request/response validation. Run with boto3 installed; no credentials."""
import unittest

try:
    import boto3
    from botocore.stub import Stubber
except ImportError:
    boto3 = None

import test_checks
from checks import AwsChecks


@unittest.skipIf(boto3 is None, "Install boto3 for AWS SDK contract checks")
class SdkContractTest(unittest.TestCase):
    def setUp(self):
        fixture = test_checks.AwsChecksTest()
        fixture.setUp()
        self.fixture = fixture
        self.clients = {name:boto3.client(name, region_name="ap-northeast-1", aws_access_key_id="fixture", aws_secret_access_key="fixture") for name in ["ec2", "ssm"]}
        self.stubs = {name:Stubber(client) for name,client in self.clients.items()}
        for stub in self.stubs.values(): stub.activate()
        self.addCleanup(lambda: [stub.deactivate() for stub in self.stubs.values()])
        self.check = AwsChecks(fixture.config, self.clients, fixture.fetch)

    def instance(self):
        f=self.fixture
        self.stubs['ec2'].add_response('describe_network_interfaces', {'NetworkInterfaces':[f.nic]}, {'NetworkInterfaceIds':['eni-lab']})
        self.stubs['ec2'].add_response('describe_instances', {'Reservations':[{'Instances':[f.instance]}]}, {'InstanceIds':['i-lab']})

    def test_launch_sdk_shapes(self):
        self.instance()
        self.stubs['ec2'].add_response('describe_instance_status', {'InstanceStatuses':[{'SystemStatus':{'Status':'ok'},'InstanceStatus':{'Status':'ok'}}]}, {'InstanceIds':['i-lab']})
        self.assertEqual(self.check.launch()['instanceId'],'i-lab')
        self.stubs['ec2'].assert_no_pending_responses()

    def test_gateway_allocation_id_and_no_reassociation(self):
        self.stubs['ec2'].add_response('describe_internet_gateways', {'InternetGateways':[self.fixture.gateway]}, {'Filters':[{'Name':'attachment.vpc-id','Values':['vpc-lab']}]})
        self.stubs['ec2'].add_response('describe_addresses', {'Addresses':[{'PublicIp':'8.8.8.8','AllocationId':'eipalloc-lab'}]}, {'AllocationIds':['eipalloc-lab']})
        self.stubs['ec2'].add_response('associate_address', {'AssociationId':'eipassoc-lab'}, {'AllocationId':'eipalloc-lab','NetworkInterfaceId':'eni-lab','AllowReassociation':False})
        self.assertEqual(self.check.gateway()['publicIp'],'8.8.8.8')
        self.stubs['ec2'].assert_no_pending_responses()

    def test_session_uses_actual_supported_filter_and_owner_fields(self):
        self.instance()
        self.stubs['ssm'].add_response('describe_sessions', {'Sessions':[{'Target':'i-lab','Owner':'arn:aws:sts::123456789012:assumed-role/lab-student/member'}]}, {'State':'Active','Filters':[{'key':'Target','value':'i-lab'}]})
        self.assertEqual(self.check.session()['session'],'verified')
        self.stubs['ssm'].assert_no_pending_responses()


if __name__=='__main__': unittest.main()
