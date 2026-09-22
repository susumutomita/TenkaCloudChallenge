"""Four private role cards. The operator distributes one card per participant."""
import hashlib
import hmac


class MemberRequired(Exception):
    pass


def member_cards(secret):
    if len(secret) < 24:
        raise ValueError('Cooperation secret too short')
    return [hmac.new(secret.encode(), ('member:' + str(i)).encode(), hashlib.sha256).hexdigest() for i in range(4)]


class Cooperation:
    def __init__(self, engine, secret):
        self.engine, self.secret = engine, secret

    def member(self, token):
        if not isinstance(token, str):
            raise MemberRequired('Use your own role card')
        for index, value in enumerate(member_cards(self.secret)):
            if hmac.compare_digest(token.encode(), value.encode()):
                return index
        raise MemberRequired('Use your own role card')

    def digits(self, index):
        digest = hmac.new(self.secret.encode(), ('round:' + str(index)).encode(), hashlib.sha256).digest()
        return [str(1 + value % 9) for value in digest[:4]]

    def personal(self, token, language):
        member = self.member(token)
        state = self.engine.store.read()
        index = state['index']
        if index >= len(KINDS):
            return {'member': member, 'done': True}
        if index == 1:
            # Rotate the assignment; the team must reconstruct the network path.
            nodes = [('ブラウザ', 'Browser'), ('インターネットゲートウェイ', 'Internet gateway'),
                     ('ルートテーブル', 'Route table'), ('EC2', 'EC2')]
            position = (member + int(self.digits(index)[0])) % 4
            clue = nodes[position][language == 'en']
        else:
            clue = self.digits(index)[member]
        return {'member': member, 'clue': clue, 'operator': index % 4, 'explainer': (index + 1) % 4}

    def expected(self, index):
        if index == 1:
            shift = int(self.digits(index)[0]) % 4
            return ''.join('ABCD'[(position - shift) % 4] for position in range(4))
        digits = self.digits(index)
        if index == 0:
            return str(sum(map(int, digits)))
        # In the last two rounds pairs exchange their two halves of the release key.
        return ''.join(digits)

    def share(self, token, answer, revision=None):
        member = self.member(token)
        old = self.engine.store.read()
        if revision is not None and old['revision'] != revision:
            raise Conflict('State changed; refresh')
        if old['phase'] not in ('active', 'review'):
            raise Conflict('Wait for the round')
        if not isinstance(answer, str) or answer.strip().upper() != self.expected(old['index']):
            return False
        joined = old.get('members', [])
        if member in joined:
            return True
        self.engine.store.save(old, {**old, 'members': sorted([*joined, member])})
        return True

    def require(self, token, operation, revision=None):
        member = self.member(token)
        state = self.engine.store.read()
        if revision is not None and state['revision'] != revision:
            raise Conflict('State changed; refresh')
        if len(state.get('members', [])) != 4:
            raise MemberRequired('Share the four clues before checking recovery')
        expected = state['index'] % 4 if operation == 'check' else (state['index'] + 1) % 4
        if member != expected:
            raise MemberRequired('Pass this action to the assigned teammate')

    def assist(self, members):
        """Operator-only absence recovery; no extra points and a visible assistance marker."""
        if not isinstance(members, list) or any(type(i) is not int or i not in range(4) for i in members):
            raise ValueError('Expected absent member numbers 0..3')
        old = self.engine.store.read()
        if old['phase'] not in ('active', 'review'):
            raise Conflict('No active round')
        return self.engine.store.save(old, {**old, 'members': sorted(set(old.get('members', []) + members)), 'assisted': True})
