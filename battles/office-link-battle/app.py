"""Participant board and real-health endpoint; no cloud fault action is public."""
import base64
import hmac
import json
import os
from urllib.parse import parse_qs


def choose(value,language):
    if isinstance(value,list):return [choose(v,language) for v in value]
    if isinstance(value,dict):
        if 'ja' in value and 'en' in value:return value[language]
        return {k:choose(v,language) for k,v in value.items() if k!='correctChoice'}
    return value


def response(status,data,mime='application/json; charset=utf-8'):
    return {'statusCode':status,'headers':{'content-type':mime,'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',
        'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"},'body':data if isinstance(data,str) else json.dumps(data,ensure_ascii=False)}


def battle():
    config=json.loads(os.environ['LAB_CONFIG'])
    checks=AwsChecks(config)
    return Battle(checks,StateStore(checks.client('dynamodb'),config['stateTable']))


def state_view(engine,language):
    state=engine.store.read()
    public={key:state[key] for key in ('revision','index','phase','deadline','recoveredBy','members','assisted') if key in state}
    public['total']=len(ROUNDS)
    if state['index']<len(ROUNDS) and state['phase'] in ('active','review','restoring'):
        public['round']=choose(ROUNDS[state['index']],language)
    public['resources']={key:engine.config[key] for key in ['region','serverName','publicIp','vpcId','subnetId','gatewayId','routeTableId','instanceProfileName','securityGroupId']}
    return public


def handler(event,context=None):
    parts=event.get('rawPath','').split('/',2)
    secret=os.environ['PLAY_KEY']
    if len(secret)<24:raise ValueError('Capability key too short')
    if len(parts)!=3 or not hmac.compare_digest(parts[1].encode(),secret.encode()):return response(404,{'error':'not_found'})
    route=parts[2];method=event.get('requestContext',{}).get('http',{}).get('method','GET')
    language='en' if parse_qs(event.get('rawQueryString','')).get('lang')==['en'] else 'ja'
    if method=='GET' and route in ('','app.js','style.css'):
        assets={'':(WEB_HTML,'text/html'),'app.js':(WEB_JS,'text/javascript'),'style.css':(WEB_CSS,'text/css')}
        return response(200,assets[route][0],assets[route][1]+'; charset=utf-8')
    engine=battle()
    try:
        if method=='GET' and route in ('health','health/'):
            if engine.store.read()['phase'] in ('applying','restoring'):return response(503,{'status':'recovering'})
            engine.health()
            return response(200,{'status':'healthy'})
        if method=='GET' and route=='api/state':return response(200,state_view(engine,language))
        if method!='POST' or route not in ('api/check','api/explain','api/personal','api/share'):return response(405,{'error':'method_not_allowed'})
        raw=event.get('body') or ''
        if len(raw)>4096:return response(413,{'error':'too_large'})
        try:
            if event.get('isBase64Encoded'):raw=base64.b64decode(raw,validate=True).decode()
            data=json.loads(raw)
        except (ValueError,UnicodeError):return response(400,{'error':'invalid_json'})
        if not isinstance(data,dict):return response(400,{'error':'invalid_submission'})
        cooperation=Cooperation(engine,os.environ['COOPERATION_SECRET'])
        if route=='api/personal':return response(200,cooperation.personal(data.get('card'),language))
        state=engine.store.read()
        if type(data.get('revision')) is not int or state['revision']!=data['revision']:raise Conflict('State changed; refresh')
        if route=='api/share':
            correct=cooperation.share(data.get('card'),data.get('answer'),data['revision'])
            return response(200,{'correct':correct,**state_view(engine,language)})
        cooperation.require(data.get('card'),route.split('/')[-1],data['revision'])
        if route=='api/check':engine.verify(data['revision'])
        elif not engine.explain(data.get('choice'),data['revision']):
            return response(200,{'correct':False,'message':choose({'ja':'図と、直す前後の違いを相談してみよう。','en':'Discuss the diagram and the change before and after recovery.'},language)})
        return response(200,{'correct':True,**state_view(engine,language)})
    except MemberRequired:
        return response(403,{'error':'member_action_required'})
    except NotReady as error:
        if route in ('health','health/'):return response(503,{'status':'unhealthy'})
        return response(200,{'correct':False,'message':OBSERVATIONS.get(str(error),str(error)) if language=='ja' else str(error)})
    except Conflict:
        return response(409,{'error':'round_changed'})
    except Exception as error:
        code=getattr(error,'response',{}).get('Error',{}).get('Code',type(error).__name__)
        return response(503,{'error':'aws_check_failed','code':code})


def operator_handler(event,context=None):
    engine=battle()
    operation=event.get('operation') if isinstance(event,dict) else None
    if isinstance(event,dict) and event.get('source')=='aws.events':return engine.recover()
    if operation=='cards':return {'cards':[{'member':'ABCD'[i],'url':os.environ['GAME_URL']+'#card='+value} for i,value in enumerate(member_cards(os.environ['COOPERATION_SECRET']))]}
    if operation=='assist':return Cooperation(engine,os.environ['COOPERATION_SECRET']).assist(event.get('members'))
    if operation=='state':return engine.store.read()
    if operation=='start':return engine.start(event.get('kind'))
    if operation=='restore':return engine.recover(force=True)
    raise ValueError('Expected state, start, restore, cards or assist')
