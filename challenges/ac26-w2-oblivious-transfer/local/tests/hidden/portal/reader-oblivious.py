from participant.ot import derive_key


def request(grp, public, choice, blind):
    value = pow(grp['g'], blind, grp['p'])
    return value if choice == 0 else public * value % grp['p']


def blind_range(grp):
    return (0, grp['q'] - 1)


def encrypt(grp, secret, public, req, message_0, message_1):
    p = grp['p']
    first = derive_key(grp, pow(req, secret, p))
    second = derive_key(grp, pow(req * pow(public, p-2, p) % p, secret, p))
    return (message_0 ^ first, message_1 ^ second)


def unwrap(grp, public, choice, blind, ciphertexts):
    return ciphertexts[choice] ^ derive_key(grp, pow(public, blind, grp['p']))


def gate_masks(randomness):
    return (randomness[0], randomness[1])


def offer(own_bit, mask):
    return (mask, mask ^ own_bit)


def output_share(own_x, own_y, own_mask, received):
    return (own_x & own_y) ^ own_mask ^ received


def needs_transfer(gate):
    return gate == 'and'
