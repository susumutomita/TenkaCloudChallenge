import json
import os
import unittest
from unittest.mock import patch
import test_battle as fixture

app=fixture.app
SECRET='cooperation-private-fixture-seed-1234'

class CooperationTest(unittest.TestCase):
    def setUp(self):
        self.base=fixture.BattleTest();self.base.setUp()
        self.engine=self.base.engine;self.store=self.base.store
        self.coop=app['Cooperation'](self.engine,SECRET)
        self.cards=app['member_cards'](SECRET)
        self.engine.start('gateway')

    def post(self,action,card=None,**values):
        with patch.dict(os.environ,{'PLAY_KEY':'p'*24,'COOPERATION_SECRET':SECRET}),patch.dict(app,{'battle':lambda:self.engine}):
            return app['handler']({'rawPath':'/'+'p'*24+'/api/'+action,'requestContext':{'http':{'method':'POST'}},'body':json.dumps({'revision':self.store.read()['revision'],'card':card,**values})})

    def test_only_each_card_reveals_its_own_clue(self):
        self.assertEqual(self.post('personal','invalid')['statusCode'],403)
        for index,card in enumerate(self.cards):
            personal=json.loads(self.post('personal',card)['body'])
            self.assertEqual(personal['member'],index)
            self.assertEqual(personal['clue'],self.coop.digits(0)[index])
            self.assertNotIn('cards',personal)
        public=json.dumps(app['state_view'](self.engine,'ja'))
        for secret in [SECRET,*self.cards]:self.assertNotIn(secret,public)

    def test_one_card_and_correct_answer_cannot_confirm_for_other_members(self):
        expected=self.coop.expected(0)
        self.assertFalse(self.coop.share(self.cards[0],'wrong'))
        self.assertNotIn('members',self.store.read())
        for _ in range(5):self.coop.share(self.cards[0],expected)
        self.assertEqual(self.store.read()['members'],[0])
        self.assertEqual(self.post('check',self.cards[0])['statusCode'],403)
        for card in self.cards[1:]:self.coop.share(card,expected)
        self.assertEqual(self.post('check',self.cards[1])['statusCode'],403)
        self.assertEqual(self.post('check',self.cards[0])['statusCode'],200)
        self.assertEqual(self.post('explain',self.cards[0],choice='0')['statusCode'],403)
        choice=str(app['ROUNDS'][0]['correctChoice'])
        self.assertEqual(self.post('explain',self.cards[1],choice=choice)['statusCode'],200)
        self.assertEqual(self.store.read()['index'],1)
        self.assertNotIn('members',self.store.read())

    def test_network_relay_requires_owners_in_path_order_and_rotates_roles(self):
        self.store.state={'revision':7,'index':1,'phase':'active'}
        clues=[self.coop.personal(card,'en')['clue'] for card in self.cards]
        order=['Browser','Internet gateway','Route table','EC2']
        answer=''.join('ABCD'[clues.index(node)] for node in order)
        self.assertEqual(answer,self.coop.expected(1))
        for card in self.cards:self.assertTrue(self.coop.share(card,answer))
        self.assertEqual(self.coop.personal(self.cards[0],'en')['operator'],1)
        self.assertEqual(self.post('check',self.cards[0])['statusCode'],403)
        self.assertEqual(self.post('check',self.cards[1])['statusCode'],200)

    def test_pair_keys_are_ordered_and_event_specific(self):
        self.store.state={'revision':3,'index':2,'phase':'active'}
        digits=[self.coop.personal(card,'ja')['clue'] for card in self.cards]
        self.assertEqual(self.coop.expected(2),''.join(digits))
        other=app['member_cards']('another-private-event-seed-1234')
        self.assertEqual(self.post('share',other[0],answer=''.join(digits))['statusCode'],403)

    def test_missing_member_assistance_is_operator_only_and_does_not_change_health(self):
        self.assertEqual(self.post('assist',self.cards[0],members=[0,1,2,3])['statusCode'],405)
        self.coop.assist([2,3]);self.assertTrue(self.store.read()['assisted'])
        self.assertEqual(self.store.read()['members'],[2,3])
        self.assertEqual(self.engine.health()['http'],200)
        with self.assertRaises(ValueError):self.coop.assist([4])

    def test_cards_are_only_returned_by_private_operator_invocation(self):
        self.assertEqual(self.post('cards',self.cards[0])['statusCode'],405)
        with patch.dict(os.environ,{'COOPERATION_SECRET':SECRET,'GAME_URL':'https://example.test/private/'}),patch.dict(app,{'battle':lambda:self.engine}):
            result=app['operator_handler']({'operation':'cards'})
        self.assertEqual(len(result['cards']),4)
        self.assertEqual(result['cards'][2],{'member':'C','url':'https://example.test/private/#card='+self.cards[2]})

    def test_revision_stays_bound_between_authorization_and_check(self):
        for card in self.cards:self.coop.share(card,self.coop.expected(0))
        old=self.store.read()
        changed={**old,'revision':old['revision']+1,'index':1}
        # Handler read and role authorization see round 0; verification sees a
        # newer round whose operator is different. Never verify it as member A.
        request={'rawPath':'/'+'p'*24+'/api/check','requestContext':{'http':{'method':'POST'}},'body':json.dumps({'revision':old['revision'],'card':self.cards[0]})}
        with patch.dict(os.environ,{'PLAY_KEY':'p'*24,'COOPERATION_SECRET':SECRET}),patch.dict(app,{'battle':lambda:self.engine}),patch.object(self.store,'read',side_effect=[old,old,changed]),patch.object(self.engine,'health') as health:
            self.assertEqual(app['handler'](request)['statusCode'],409)
            health.assert_not_called()
        self.assertEqual(self.store.read(),old)

    def test_role_seed_is_private_and_has_no_new_public_output_or_resource(self):
        template=fixture.builder['template']()
        self.assertTrue(template['Parameters']['CooperationSecret']['NoEcho'])
        self.assertNotIn('CooperationSecret',json.dumps(template['Outputs']))
        self.assertNotIn('COOPERATION_SECRET',json.dumps(template['Resources']['ParticipantViewerRole']))
        self.assertEqual(template['Outputs']['HealthUrl']['Value'],'')

if __name__=='__main__':unittest.main()
