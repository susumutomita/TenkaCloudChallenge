"""Cleanup can never hide denied API calls or terminate another team's VM."""
import runpy
import unittest
from pathlib import Path
from unittest.mock import Mock

cleanup=runpy.run_path(str(Path(__file__).resolve().parents[1]/'cleanup.py'))
class AwsError(Exception):
    def __init__(self,code): self.response={'Error':{'Code':code}}

class CleanupTest(unittest.TestCase):
    def setUp(self):
        self.config={'allocationId':'eipalloc-own','networkInterfaceId':'eni-own','vpcId':'vpc-own','namePrefix':'tc-own'}
        self.ec2=Mock()
        self.ec2.describe_addresses.return_value={'Addresses':[{'AssociationId':'assoc-own','NetworkInterfaceId':'eni-own'}]}
        self.ec2.describe_network_interfaces.return_value={'NetworkInterfaces':[{'Attachment':{'InstanceId':'i-own'}}]}
        self.ec2.describe_instances.return_value={'Reservations':[{'Instances':[{'VpcId':'vpc-own','Tags':[{'Key':'TenkaCloud:NamePrefix','Value':'tc-own'}]}]}]}
        self.ec2.describe_internet_gateways.return_value={'InternetGateways':[{'InternetGatewayId':'igw-own','Attachments':[{'VpcId':'vpc-own'}]}]}

    def test_orders_disassociation_termination_wait_and_gateway_removal(self):
        cleanup['execute'](self.ec2,self.config)
        names=[c[0] for c in self.ec2.mock_calls]
        self.assertLess(names.index('disassociate_address'),names.index('terminate_instances'))
        self.assertLess(names.index('modify_instance_attribute'),names.index('terminate_instances'))
        self.ec2.modify_instance_attribute.assert_called_once_with(InstanceId='i-own',DisableApiTermination={'Value':False})
        self.assertLess(names.index('get_waiter().wait'),names.index('detach_internet_gateway'))
        self.ec2.terminate_instances.assert_called_once_with(InstanceIds=['i-own'])
        self.ec2.delete_internet_gateway.assert_called_once_with(InternetGatewayId='igw-own')

    def test_other_team_address_or_instance_fails_without_destructive_call(self):
        self.ec2.describe_addresses.return_value['Addresses'][0]['NetworkInterfaceId']='eni-other'
        with self.assertRaises(ValueError): cleanup['execute'](self.ec2,self.config)
        self.ec2.disassociate_address.assert_not_called()
        self.ec2.describe_addresses.return_value={'Addresses':[]}
        self.ec2.describe_instances.return_value['Reservations'][0]['Instances'][0]['VpcId']='vpc-other'
        with self.assertRaises(ValueError): cleanup['execute'](self.ec2,self.config)
        self.ec2.modify_instance_attribute.assert_not_called()
        self.ec2.terminate_instances.assert_not_called()

    def test_cannot_disable_protection_is_a_cleanup_failure(self):
        self.ec2.modify_instance_attribute.side_effect=AwsError('UnauthorizedOperation')
        with self.assertRaises(AwsError):cleanup['execute'](self.ec2,self.config)
        self.ec2.terminate_instances.assert_not_called()
        self.ec2.delete_internet_gateway.assert_not_called()

    def test_already_deleted_is_idempotent_but_access_denied_is_not_success(self):
        self.ec2.describe_addresses.side_effect=AwsError('InvalidAllocationID.NotFound')
        self.ec2.describe_network_interfaces.side_effect=AwsError('InvalidNetworkInterfaceID.NotFound')
        self.ec2.describe_internet_gateways.return_value={'InternetGateways':[]}
        cleanup['execute'](self.ec2,self.config)
        self.ec2.terminate_instances.assert_not_called()
        self.ec2.describe_addresses.side_effect=AwsError('UnauthorizedOperation')
        with self.assertRaises(AwsError): cleanup['execute'](self.ec2,self.config)

if __name__=='__main__': unittest.main()
