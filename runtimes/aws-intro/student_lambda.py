"""The student's supplied function: no scoring flags or grader permissions."""
import json
import os


def handler(event, context):
    if not isinstance(event, dict) or event.get('team') != os.environ['TEAM_NAME'] or type(event.get('parcels')) is not int or event['parcels'] != 3:
        return {'accepted':False,'message':'Use the supplied team name and parcels: 3.'}
    destination=['SHIZUOKA','YOKOHAMA'][int(context.aws_request_id.replace('-','')[-1],16)%2]
    record={'receipt':context.aws_request_id,'team':os.environ['TEAM_NAME'],'parcels':3,'destination':destination}
    print(json.dumps(record))
    # The recipient is deliberately in the log, not the execution response.
    return {'accepted':True,'parcels':3,'receipt':context.aws_request_id}
