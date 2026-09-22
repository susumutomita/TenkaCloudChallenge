"""One reversible fault per team. The operator function has no public URL."""
import json
import time
from checks import AwsChecks, NotReady


class Conflict(Exception):
    pass


class StateStore:
    def __init__(self, client, table):
        self.client,self.table=client,table

    def read(self):
        item=self.client.get_item(TableName=self.table,Key={'id':{'S':'round'}},ConsistentRead=True).get('Item')
        if not item:return {'revision':0,'index':0,'phase':'idle'}
        return json.loads(item['payload']['S'])

    def save(self, old, new):
        value={**new,'revision':old['revision']+1}
        args={'TableName':self.table,'Item':{'id':{'S':'round'},'revision':{'N':str(value['revision'])},'payload':{'S':json.dumps(value)}},
            'ConditionExpression':'attribute_not_exists(id)' if old['revision']==0 else '#revision = :revision'}
        if old['revision']:
            args.update(ExpressionAttributeNames={'#revision':'revision'},ExpressionAttributeValues={':revision':{'N':str(old['revision'])}})
        try:self.client.put_item(**args)
        except Exception as error:
            if getattr(error,'response',{}).get('Error',{}).get('Code')=='ConditionalCheckFailedException':raise Conflict('State changed; refresh') from error
            raise
        return value


KINDS=('gateway','route','role','http')


class Battle:
    def __init__(self, checks, store, now=None):
        self.checks,self.store,self.config=checks,store,checks.config
        self.now=now or time.time

    def health(self):
        # The prepared server must actually answer, and the management role
        # must be attached. A successful Lambda URL alone earns nothing.
        self.checks.gateway()  # Re-associate the reserved IP only after the learner attaches the IGW.
        self.checks.http()
        instance,_nic=self.checks.instance()
        if instance.get('IamInstanceProfile',{}).get('Arn')!=self.config['instanceProfileArn']:
            raise NotReady('Attach the prepared EC2 role to restore management access')
        state=self.store.read()
        if state.get('kind')=='role' and state['phase']=='active':
            self.checks.session(after=state['startedAt'])
        return {'http':200,'managementRole':'attached'}

    def start(self, kind):
        old=self.store.read()
        if old['phase']!='idle' or old['index']>=len(KINDS) or KINDS[old['index']]!=kind:
            raise Conflict('Finish the current round and explanation before starting the next')
        self.health()
        active=self.store.save(old,{**old,'phase':'applying','kind':kind,'startedAt':int(self.now()),'deadline':int(self.now())+600})
        try:
            self.apply(kind)
        except Exception:
            # Keep authority/state visible. Watchdog retries recovery even if
            # an API applied the mutation and the response was lost.
            self.store.save(active,{**active,'phase':'restoring','deadline':int(self.now())})
            raise
        return self.store.save(active,{**active,'phase':'active'})

    def verify(self, revision=None):
        old=self.store.read()
        if revision is not None and old['revision']!=revision:raise Conflict('State changed; refresh')
        if old['phase']!='active':raise Conflict('Refresh the round before checking')
        self.health()
        return self.store.save(old,{**old,'phase':'review','recoveredBy':'team'})

    def explain(self, choice, revision=None):
        old=self.store.read()
        if revision is not None and old['revision']!=revision:raise Conflict('State changed; refresh')
        if old['phase']!='review':raise Conflict('Check recovery before the explanation')
        if choice != str(ROUNDS[old['index']]['correctChoice']):return False
        self.store.save(old,{'phase':'idle','index':old['index']+1,'revision':old['revision']})
        return True

    def recover(self, force=False):
        old=self.store.read()
        if old['phase'] not in ('active','applying','restoring'):return old
        if old['phase']=='restoring' and self.now()<old.get('recoverAfter',0):return old
        if not force and old['phase']=='applying' and self.now()<old['deadline']:raise Conflict('Fault is still being applied')
        if not force and self.now()<old['deadline']:return old
        # A recovery lease exceeds the operator Lambda's 120-second timeout.
        # Duplicate timer deliveries must not restore concurrently.
        state=self.store.save(old,{**old,'phase':'restoring','recoverAfter':int(self.now())+180})
        self.restore(state['kind'])
        self.health()
        return self.store.save(state,{**state,'phase':'review','recoveredBy':'operator' if force else 'watchdog'})

    def apply(self, kind):
        ec2=self.checks.client('ec2');c=self.config
        instance,_nic=self.checks.instance()
        if kind=='gateway':
            addresses=ec2.describe_addresses(AllocationIds=[c['allocationId']])['Addresses']
            if len(addresses)!=1 or addresses[0].get('NetworkInterfaceId')!=c['networkInterfaceId']:
                raise ValueError('Unexpected public address owner')
            ec2.disassociate_address(AssociationId=addresses[0]['AssociationId'])
            # AWS refuses IGW detachment while a public address remains.
            ec2.detach_internet_gateway(InternetGatewayId=c['gatewayId'],VpcId=c['vpcId'])
        elif kind=='route':ec2.delete_route(RouteTableId=c['routeTableId'],DestinationCidrBlock='0.0.0.0/0')
        elif kind=='role':
            associations=ec2.describe_iam_instance_profile_associations(Filters=[{'Name':'instance-id','Values':[instance['InstanceId']]}])['IamInstanceProfileAssociations']
            current=[a for a in associations if a['State']=='associated']
            if len(current)!=1 or current[0]['IamInstanceProfile']['Arn']!=c['instanceProfileArn']:raise ValueError('Unexpected instance profile')
            ec2.disassociate_iam_instance_profile(AssociationId=current[0]['AssociationId'])
        elif kind=='http':ec2.revoke_security_group_ingress(GroupId=c['securityGroupId'],IpPermissions=[self.http_rule()])
        else:raise ValueError('Unknown fault')

    def http_rule(self):return {'IpProtocol':'tcp','FromPort':80,'ToPort':80,'IpRanges':[{'CidrIp':self.config['httpSourceCidr']}]}

    def restore(self, kind):
        ec2=self.checks.client('ec2');c=self.config
        instance,_nic=self.checks.instance()
        if kind=='gateway':
            gateways=ec2.describe_internet_gateways(InternetGatewayIds=[c['gatewayId']])['InternetGateways']
            if len(gateways)!=1:raise ValueError('Gateway absent')
            attached=gateways[0].get('Attachments',[])
            if any(a['VpcId']!=c['vpcId'] for a in attached):raise ValueError('Gateway attached elsewhere')
            if not attached:ec2.attach_internet_gateway(InternetGatewayId=c['gatewayId'],VpcId=c['vpcId'])
            self.checks.gateway()
        elif kind=='route':
            routes=ec2.describe_route_tables(RouteTableIds=[c['routeTableId']])['RouteTables']
            if len(routes)!=1 or routes[0]['VpcId']!=c['vpcId']:raise ValueError('Unexpected route table')
            action=ec2.replace_route if any(r.get('DestinationCidrBlock')=='0.0.0.0/0' for r in routes[0]['Routes']) else ec2.create_route
            action(RouteTableId=c['routeTableId'],DestinationCidrBlock='0.0.0.0/0',GatewayId=c['gatewayId'])
        elif kind=='role':
            associations=ec2.describe_iam_instance_profile_associations(Filters=[{'Name':'instance-id','Values':[instance['InstanceId']]}])['IamInstanceProfileAssociations']
            current=[a for a in associations if a['State'] in ('associated','associating')]
            if not current:ec2.associate_iam_instance_profile(InstanceId=instance['InstanceId'],IamInstanceProfile={'Arn':c['instanceProfileArn']})
            elif len(current)==1:
                if current[0]['IamInstanceProfile']['Arn']!=c['instanceProfileArn']:
                    ec2.replace_iam_instance_profile_association(AssociationId=current[0]['AssociationId'],IamInstanceProfile={'Arn':c['instanceProfileArn']})
            else:raise ValueError('Ambiguous profile associations')
        elif kind=='http':
            groups=ec2.describe_security_groups(GroupIds=[c['securityGroupId']])['SecurityGroups']
            if len(groups)!=1 or groups[0]['VpcId']!=c['vpcId']:raise ValueError('Unexpected security group')
            required=[self.http_rule(),{'IpProtocol':'tcp','FromPort':8080,'ToPort':8080,'IpRanges':[{'CidrIp':'0.0.0.0/0'}]}]
            for rule in groups[0].get('IpPermissions',[]):
                if rule not in required:ec2.revoke_security_group_ingress(GroupId=c['securityGroupId'],IpPermissions=[rule])
            for rule in required:
                try:ec2.authorize_security_group_ingress(GroupId=c['securityGroupId'],IpPermissions=[rule])
                except Exception as error:
                    if getattr(error,'response',{}).get('Error',{}).get('Code')!='InvalidPermission.Duplicate':raise
        else:raise ValueError('Unknown fault')
