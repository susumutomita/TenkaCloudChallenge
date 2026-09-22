"""AWS observations for the introductory workshop family.

Resource identities come only from the deployed stack, never from a submitted
ARN or URL. Clients are injected in unit tests; production uses the AWS SDK.
No check converts an AWS error into a successful or empty observation.
"""
import ipaddress
import json
import urllib.request
import urllib.error


from check_errors import NotReady, require


def tags_match(resource, prefix):
    return any(t.get("Key") == "TenkaCloud:NamePrefix" and t.get("Value") == prefix
               for t in resource.get("Tags", []))


def fetch_json(url):
    # The caller constructs this URL from the stack's EC2 address. Never follow
    # a student's redirect to another team, metadata endpoint, or private host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect, urllib.request.ProxyHandler({}))
    try:
        with opener.open(url, timeout=4) as response:
            require(response.status == 200, "HTTP response is not 200")
            data = response.read(8193)
    except (urllib.error.URLError, TimeoutError) as error:
        raise NotReady("The lab page could not be reached") from error
    require(len(data) <= 8192, "HTTP response is too large")
    try:
        return json.loads(data)
    except (ValueError, UnicodeError) as error:
        raise NotReady("The lab page returned invalid data") from error


from service_checks import ServiceChecks


class AwsChecks(ServiceChecks):
    def __init__(self, config, clients=None, fetch=fetch_json):
        self.config = config
        self.clients = clients if clients is not None else {}
        self.fetch = fetch

    def client(self, service):
        if service not in self.clients:
            import boto3
            from botocore.config import Config
            self.clients[service] = boto3.client(service, region_name=self.config["region"],
                config=Config(connect_timeout=3, read_timeout=5, retries={"max_attempts": 1}))
        return self.clients[service]

    def instance(self):
        ec2 = self.client("ec2")
        nic = ec2.describe_network_interfaces(NetworkInterfaceIds=[self.config["networkInterfaceId"]])["NetworkInterfaces"]
        require(len(nic) == 1 and nic[0]["VpcId"] == self.config["vpcId"], "Lab network interface does not match")
        instance_id = nic[0].get("Attachment", {}).get("InstanceId")
        require(bool(instance_id), "The lab network interface has no running server yet")
        reservations = ec2.describe_instances(InstanceIds=[instance_id])["Reservations"]
        instances = [i for r in reservations for i in r.get("Instances", [])]
        require(len(instances) == 1, "The lab server could not be identified")
        instance = instances[0]
        require(instance["VpcId"] == self.config["vpcId"] and instance["SubnetId"] == self.config["subnetId"], "Server is outside the lab network")
        require(tags_match(instance, self.config["namePrefix"]), "Server does not belong to this lab")
        require(instance["State"]["Name"] == "running", "Wait for the server to enter running state")
        require(instance["ImageId"] == self.config["imageId"], "Server image differs from the lab image")
        require(instance["InstanceType"] == self.config["instanceType"], "Server size differs from the lab size")
        return instance, nic[0]

    def launch(self):
        instance, _ = self.instance()
        statuses = self.client("ec2").describe_instance_status(InstanceIds=[instance["InstanceId"]])["InstanceStatuses"]
        require(len(statuses) == 1, "AWS has not reported the server checks yet")
        require(all(statuses[0].get(key, {}).get("Status") == "ok" for key in ("SystemStatus", "InstanceStatus")), "Wait for both EC2 status checks to pass")
        return {"instanceId": instance["InstanceId"], "state": "running", "checks": "ok"}

    def attached_gateway(self):
        gateways = self.client("ec2").describe_internet_gateways(Filters=[{"Name": "attachment.vpc-id", "Values": [self.config["vpcId"]]}])["InternetGateways"]
        require(len(gateways) == 1, "The lab VPC needs an attached internet gateway")
        gateway = gateways[0]
        require(tags_match(gateway, self.config["namePrefix"]), "Use the gateway created for this lab")
        require(any(a.get("VpcId") == self.config["vpcId"] and a.get("State") == "available" for a in gateway.get("Attachments", [])), "Wait for the gateway attachment to become available")
        return gateway["InternetGatewayId"]

    def gateway(self):
        gateway_id = self.attached_gateway()
        # Existing interfaces cannot request auto-assigned public IPv4 at
        # launch. The host supplies one reserved EIP only after the learner
        # connects the IGW. This is setup assistance, explicitly shown in UI.
        ec2 = self.client("ec2")
        addresses = ec2.describe_addresses(AllocationIds=[self.config["allocationId"]])["Addresses"]
        require(len(addresses) == 1, "The host's lab address is unavailable")
        address = addresses[0]
        require(address.get("NetworkInterfaceId") in (None, self.config["networkInterfaceId"]), "The lab address is attached to a different resource")
        if not address.get("AssociationId"):
            ec2.associate_address(AllocationId=self.config["allocationId"], NetworkInterfaceId=self.config["networkInterfaceId"], AllowReassociation=False)
        return {"gatewayId": gateway_id, "publicIp": address["PublicIp"]}

    def route_config(self):
        gateway_id = self.attached_gateway()
        tables = self.client("ec2").describe_route_tables(RouteTableIds=[self.config["routeTableId"]])["RouteTables"]
        require(len(tables) == 1 and tables[0]["VpcId"] == self.config["vpcId"], "The route table does not belong to this lab")
        table = tables[0]
        require(any(a.get("SubnetId") == self.config["subnetId"] and a.get("AssociationState", {}).get("State") == "associated" for a in table.get("Associations", [])), "The route table is not associated with the lab subnet")
        require(any(r.get("DestinationCidrBlock") == "0.0.0.0/0" and r.get("GatewayId") == gateway_id and r.get("State") == "active" for r in table.get("Routes", [])), "The subnet needs an active route to its attached internet gateway")
        return gateway_id

    def server_response(self, port):
        instance, nic = self.instance()
        address = nic.get("Association", {}).get("PublicIp")
        require(bool(address), "The lab server has no public address yet")
        require(ipaddress.ip_address(address).is_global, "The lab address must be a public IP")
        data = self.fetch(f"http://{address}:{port}/check")
        require(isinstance(data, dict) and data.get("lab") == self.config["namePrefix"], "The responding server is not this team's lab")
        return instance, address, data

    def route(self):
        gateway_id = self.route_config()
        _, address, data = self.server_response(8080)
        require(data.get("outboundIp") == address, "The lab server's outbound HTTPS check did not succeed")
        return {"gatewayId": gateway_id, "outboundHttps": True}

    def session(self, after=0):
        instance, _, data = self.server_response(8080)
        require(instance.get("IamInstanceProfile", {}).get("Arn") == self.config["instanceProfileArn"], "The lab's Session Manager role is not attached")
        require(data.get("sessionCommandRan") is True, "Run the workshop check command inside your Session Manager session")
        if after:
            require(isinstance(data.get("sessionCommandAt"), (int, float)) and data['sessionCommandAt'] >= after, "Run the check command again after this recovery round started")
        expected_owner = f"arn:{self.config.get('partition', 'aws')}:sts::{self.config['accountId']}:assumed-role/{self.config['participantRoleName']}/"
        ssm = self.client("ssm")
        for state in ("Active", "History"):
            request = {"State": state, "Filters": [{"key": "Target", "value": instance["InstanceId"]}]}
            while True:
                result = ssm.describe_sessions(**request)
                if any(s.get("Target") == instance["InstanceId"] and s.get("Owner", "").startswith(expected_owner)
                       and (not after or (s.get('StartDate') is not None and s['StartDate'].timestamp() >= after)) for s in result.get("Sessions", [])):
                    return {"instanceId": instance["InstanceId"], "session": "verified", "command": "verified"}
                if not result.get("NextToken"):
                    break
                request["NextToken"] = result["NextToken"]
        raise NotReady("No Session Manager session from this team's participant role was found")

    def http(self):
        self.route_config()
        instance, nic = self.instance()
        # Additional attached groups could make a too-wide rule effective even
        # if the expected group looks correct. Check the actual NIC's groups.
        require({g["GroupId"] for g in nic.get("Groups", [])} == {self.config["securityGroupId"]}, "Use only the lab security group")
        groups = self.client("ec2").describe_security_groups(GroupIds=[self.config["securityGroupId"]])["SecurityGroups"]
        require(len(groups) == 1 and groups[0]["VpcId"] == self.config["vpcId"], "Security group does not belong to the lab")
        required = ("tcp", 80, 80, self.config["httpSourceCidr"])
        control = ("tcp", 8080, 8080, "0.0.0.0/0")
        actual = set()
        for permission in groups[0].get("IpPermissions", []):
            require(not permission.get("Ipv6Ranges") and not permission.get("UserIdGroupPairs") and not permission.get("PrefixListIds"), "Remove unrelated inbound permissions")
            for source in permission.get("IpRanges", []):
                actual.add((permission.get("IpProtocol"), permission.get("FromPort"), permission.get("ToPort"), source["CidrIp"]))
        require(actual == {required, control}, "Allow the requested HTTP source and keep only the lab's fixed observation port")
        _, address, data = self.server_response(80)
        require(data.get("outboundIp") == address, "The lab server's outbound HTTPS check did not succeed")
        return {"instanceId": instance["InstanceId"], "httpStatus": 200, "sourceCidr": self.config["httpSourceCidr"]}

    def run(self, kind, inputs=None):
        if kind in ("dynamodb-create", "dynamodb-update"):
            return self.dynamodb_item("waiting" if kind == "dynamodb-create" else "done")
        if kind in ("lambda-run", "lambda-logs"):
            return self.lambda_record(inputs or {}, kind == "lambda-logs")
        allowed = {"launch": self.launch, "gateway": self.gateway, "route": self.route,
                   "session": self.session, "http": self.http, "s3-save": self.s3_object, "s3-restore": self.s3_restore,
                   "sqs": self.sqs_delivery, "cpu-alarm": self.cpu_alarm}
        if kind not in allowed:
            raise ValueError("Unsupported AWS check")
        return allowed[kind]()
