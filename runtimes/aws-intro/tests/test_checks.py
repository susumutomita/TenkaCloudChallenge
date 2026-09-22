"""Contract fixtures exercise AWS observations, not a substitute AWS deployment."""
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from checks import AwsChecks, NotReady


class AwsChecksTest(unittest.TestCase):
    def setUp(self):
        self.config = dict(namePrefix="tc-office-team1", region="ap-northeast-1", accountId="123456789012",
            networkInterfaceId="eni-lab", vpcId="vpc-lab", subnetId="subnet-lab", imageId="ami-lab",
            instanceType="t3.micro", routeTableId="rtb-lab", allocationId="eipalloc-lab",
            securityGroupId="sg-lab", httpSourceCidr="0.0.0.0/0", instanceProfileArn="arn:aws:iam::123456789012:instance-profile/lab",
            participantRoleName="lab-student")
        self.ec2, self.ssm = Mock(), Mock()
        self.tag = {"Key": "TenkaCloud:NamePrefix", "Value": self.config["namePrefix"]}
        self.instance = dict(InstanceId="i-lab", VpcId="vpc-lab", SubnetId="subnet-lab", State={"Name": "running"},
            ImageId="ami-lab", InstanceType="t3.micro", Tags=[self.tag], IamInstanceProfile={"Arn": self.config["instanceProfileArn"]})
        self.nic = dict(NetworkInterfaceId="eni-lab", VpcId="vpc-lab", Attachment={"InstanceId": "i-lab"},
            Association={"PublicIp": "8.8.8.8"}, Groups=[{"GroupId": "sg-lab"}])
        self.gateway = dict(InternetGatewayId="igw-lab", Tags=[self.tag], Attachments=[{"VpcId": "vpc-lab", "State": "available"}])
        self.table = dict(VpcId="vpc-lab", Associations=[{"SubnetId": "subnet-lab", "AssociationState": {"State": "associated"}}],
            Routes=[{"DestinationCidrBlock": "0.0.0.0/0", "GatewayId": "igw-lab", "State": "active"}])
        self.group = dict(VpcId="vpc-lab", IpPermissions=[dict(IpProtocol="tcp", FromPort=p, ToPort=p,
            IpRanges=[{"CidrIp": "0.0.0.0/0"}]) for p in [80, 8080]])
        self.ec2.describe_network_interfaces.return_value = {"NetworkInterfaces": [self.nic]}
        self.ec2.describe_instances.return_value = {"Reservations": [{"Instances": [self.instance]}]}
        self.ec2.describe_instance_status.return_value = {"InstanceStatuses": [{"SystemStatus": {"Status": "ok"}, "InstanceStatus": {"Status": "ok"}}]}
        self.ec2.describe_internet_gateways.return_value = {"InternetGateways": [self.gateway]}
        self.ec2.describe_route_tables.return_value = {"RouteTables": [self.table]}
        self.ec2.describe_security_groups.return_value = {"SecurityGroups": [self.group]}
        self.ec2.describe_addresses.return_value = {"Addresses": [{"PublicIp": "8.8.8.8"}]}
        self.response = {"lab": "tc-office-team1", "outboundIp": "8.8.8.8", "sessionCommandRan": True}
        self.fetch = Mock(side_effect=lambda _: self.response)
        self.check = AwsChecks(self.config, {"ec2": self.ec2, "ssm": self.ssm}, self.fetch)

    def test_launch_requires_both_real_status_checks(self):
        self.assertEqual(self.check.launch()["instanceId"], "i-lab")
        self.ec2.describe_instance_status.return_value["InstanceStatuses"][0]["InstanceStatus"]["Status"] = "initializing"
        with self.assertRaises(NotReady): self.check.launch()
        self.ec2.describe_instances.assert_called_with(InstanceIds=["i-lab"])
        self.ec2.describe_network_interfaces.assert_called_with(NetworkInterfaceIds=["eni-lab"])

    def test_cross_team_instance_is_rejected(self):
        self.instance["Tags"] = [{"Key": "TenkaCloud:NamePrefix", "Value": "another-team"}]
        with self.assertRaises(NotReady): self.check.launch()

    def test_wrong_vpc_image_size_or_state_cannot_pass(self):
        original = copy.deepcopy(self.instance)
        for key, bad in [("VpcId", "vpc-other"), ("ImageId", "ami-other"), ("InstanceType", "m5.large"), ("State", {"Name": "stopped"})]:
            self.instance.clear(); self.instance.update(copy.deepcopy(original)); self.instance[key] = bad
            with self.subTest(key=key), self.assertRaises(NotReady): self.check.launch()

    def test_api_error_is_not_a_pass_or_empty_observation(self):
        self.ec2.describe_network_interfaces.side_effect = RuntimeError("AccessDenied")
        with self.assertRaisesRegex(RuntimeError, "AccessDenied"): self.check.launch()

    def test_gateway_supplies_only_fixed_host_address_after_attachment(self):
        self.check.gateway()
        self.ec2.associate_address.assert_called_once_with(AllocationId="eipalloc-lab", NetworkInterfaceId="eni-lab", AllowReassociation=False)

    def test_gateway_retry_does_not_move_address(self):
        self.ec2.describe_addresses.return_value["Addresses"][0].update(AssociationId="eipassoc-lab", NetworkInterfaceId="eni-lab")
        self.check.gateway()
        self.ec2.associate_address.assert_not_called()

    def test_gateway_never_steals_address_or_accepts_other_team(self):
        self.ec2.describe_addresses.return_value["Addresses"][0]["NetworkInterfaceId"] = "eni-other"
        with self.assertRaises(NotReady): self.check.gateway()
        self.ec2.associate_address.assert_not_called()
        self.gateway["Tags"] = []
        with self.assertRaises(NotReady): self.check.gateway()

    def test_missing_gateway_does_not_trigger_association(self):
        self.ec2.describe_internet_gateways.return_value = {"InternetGateways": []}
        with self.assertRaises(NotReady): self.check.gateway()
        self.ec2.associate_address.assert_not_called()

    def test_route_requires_actual_subnet_association_and_active_gateway(self):
        self.assertTrue(self.check.route()["outboundHttps"])
        self.table["Routes"][0]["State"] = "blackhole"
        with self.assertRaises(NotReady): self.check.route()
        self.table["Routes"][0]["State"] = "active"
        self.table["Associations"][0]["SubnetId"] = "subnet-other"
        with self.assertRaises(NotReady): self.check.route()

    def test_route_also_checks_outbound_observation(self):
        self.response["outboundIp"] = ""
        with self.assertRaises(NotReady): self.check.route()

    def test_http_probe_rejects_private_ip_before_request(self):
        for address in ["127.0.0.1", "169.254.169.254", "10.0.0.1"]:
            self.nic["Association"]["PublicIp"] = address
            with self.subTest(address=address), self.assertRaises(NotReady): self.check.server_response(80)
        self.fetch.assert_not_called()

    def test_http_requires_team_identity_and_exact_ingress(self):
        self.assertEqual(self.check.http()["httpStatus"], 200)
        self.group["IpPermissions"].append(dict(IpProtocol="-1", IpRanges=[{"CidrIp": "0.0.0.0/0"}]))
        with self.assertRaises(NotReady): self.check.http()
        self.group["IpPermissions"].pop()
        self.response["lab"] = "another-team"
        with self.assertRaises(NotReady): self.check.http()

    def test_extra_security_group_cannot_bypass_ingress_check(self):
        self.nic["Groups"].append({"GroupId": "sg-wide"})
        with self.assertRaises(NotReady): self.check.http()

    def test_http_response_alone_does_not_hide_failed_outbound_connectivity(self):
        self.response['outboundIp'] = None
        with self.assertRaises(NotReady): self.check.http()

    def test_session_online_alone_does_not_prove_student_connected(self):
        self.ssm.describe_sessions.return_value = {"Sessions": []}
        with self.assertRaises(NotReady): self.check.session()

    def test_session_checks_profile_command_owner_and_target(self):
        self.ssm.describe_sessions.return_value = {"Sessions": [{"Target": "i-lab", "Owner": "arn:aws:sts::123456789012:assumed-role/lab-student/member"}]}
        self.assertEqual(self.check.session()["session"], "verified")
        self.response["sessionCommandRan"] = False
        with self.assertRaises(NotReady): self.check.session()
        self.response["sessionCommandRan"] = True
        self.instance["IamInstanceProfile"]["Arn"] = "another-profile"
        with self.assertRaises(NotReady): self.check.session()

    def test_session_pagination_and_other_role_rejection(self):
        self.ssm.describe_sessions.side_effect = [
            {"Sessions": [{"Target": "i-lab", "Owner": "arn:aws:sts::123456789012:assumed-role/other/member"}], "NextToken": "next"},
            {"Sessions": []},
            {"Sessions": [{"Target": "i-lab", "Owner": "arn:aws:sts::123456789012:assumed-role/lab-student/member"}]},
        ]
        self.assertEqual(self.check.session()["session"], "verified")
        self.assertEqual(self.ssm.describe_sessions.call_args_list[1].kwargs["NextToken"], "next")

    def test_unknown_checks_do_not_dispatch_arbitrary_attributes(self):
        with self.assertRaises(ValueError): self.check.run("client")


if __name__ == "__main__":
    unittest.main()
