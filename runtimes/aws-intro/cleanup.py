"""CloudFormation deletion of student-created lab resources, never another lab."""
import json
import os
import urllib.request


def absent_ok(read, missing_code):
    """A confirmed already-deleted resource is the only empty fallback."""
    try:
        return read()
    except Exception as error:
        if getattr(error, "response", {}).get("Error", {}).get("Code") == missing_code:
            return []
        raise


def execute(ec2, config):
    addresses = absent_ok(lambda: ec2.describe_addresses(AllocationIds=[config["allocationId"]])["Addresses"], "InvalidAllocationID.NotFound")
    for address in addresses:
        if address.get("AssociationId"):
            if address.get("NetworkInterfaceId") != config["networkInterfaceId"]:
                raise ValueError("Lab address is attached outside the lab")
            ec2.disassociate_address(AssociationId=address["AssociationId"])
    interfaces = absent_ok(lambda: ec2.describe_network_interfaces(NetworkInterfaceIds=[config["networkInterfaceId"]])["NetworkInterfaces"], "InvalidNetworkInterfaceID.NotFound")
    for nic in interfaces:
        instance_id = nic.get("Attachment", {}).get("InstanceId")
        if instance_id:
            reservations = ec2.describe_instances(InstanceIds=[instance_id])["Reservations"]
            instance = reservations[0]["Instances"][0]
            tags = {t["Key"]: t["Value"] for t in instance.get("Tags", [])}
            if instance["VpcId"] != config["vpcId"] or tags.get("TenkaCloud:NamePrefix") != config["namePrefix"]:
                raise ValueError("Instance does not belong to this lab")
            ec2.terminate_instances(InstanceIds=[instance_id])
            ec2.get_waiter("instance_terminated").wait(InstanceIds=[instance_id], WaiterConfig={"Delay": 5, "MaxAttempts": 30})
    gateways = ec2.describe_internet_gateways(Filters=[{"Name": "tag:TenkaCloud:NamePrefix", "Values": [config["namePrefix"]]}])["InternetGateways"]
    for gateway in gateways:
        for attachment in gateway.get("Attachments", []):
            if attachment["VpcId"] != config["vpcId"]:
                raise ValueError("Gateway is attached outside the lab")
            ec2.detach_internet_gateway(InternetGatewayId=gateway["InternetGatewayId"], VpcId=config["vpcId"])
        ec2.delete_internet_gateway(InternetGatewayId=gateway["InternetGatewayId"])


def handler(event, context):
    import boto3
    config = json.loads(os.environ["LAB_CONFIG"])
    status, reason = "SUCCESS", "Lab cleanup complete"
    try:
        if event["RequestType"] == "Delete":
            ec2 = boto3.client("ec2", region_name=config["region"])
            execute(ec2, config)
    except Exception as error:
        status = "FAILED"
        reason = "Lab cleanup failed: " + getattr(error, "response", {}).get("Error", {}).get("Code", type(error).__name__)
    body = json.dumps({"Status": status, "Reason": reason, "PhysicalResourceId": event.get("PhysicalResourceId", "office-lab-cleanup"),
        "StackId": event["StackId"], "RequestId": event["RequestId"], "LogicalResourceId": event["LogicalResourceId"], "Data": {}}).encode()
    request = urllib.request.Request(event["ResponseURL"], data=body, method="PUT", headers={"Content-Type": "", "Content-Length": str(len(body))})
    with urllib.request.urlopen(request, timeout=10) as result:
        if result.status != 200:
            raise RuntimeError("CloudFormation response could not be delivered")
