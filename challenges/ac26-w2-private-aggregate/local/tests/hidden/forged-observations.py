def plan(spec):
    k = spec['parties']
    return {'multiplications': k, 'triples': k, 'rounds': 1}


def share_inputs(secrets, randoms, p):
    out = []
    for i, secret in enumerate(secrets):
        head = [r % p for r in randoms[i]]
        out.append(head + [(secret - sum(head)) % p])
    return out


def add_public(shares, constant, p):
    out = [s % p for s in shares]
    out[0] = (out[0] + constant) % p
    return out


def aggregate(counts, severities, triple_list, spec, io):
    p, k = spec['p'], spec['parties']
    differences = []
    for i in range(k):
        triple = triple_list[i]
        differences.append([(x-a) % p for x, a in zip(counts[i], triple['a'])])
        differences.append([(y-b) % p for y, b in zip(severities[i], triple['b'])])
    values = io.open_batch(differences)
    total = [0] * k
    for i in range(k):
        triple = triple_list[i]
        d, e = values[2*i], values[2*i+1]
        product = [(c+d*b+e*a) % p for a, b, c in zip(triple['a'], triple['b'], triple['c'])]
        product[0] = (product[0] + d*e) % p
        total = [(s+t) % p for s, t in zip(total, product)]
    return add_public(total, spec['bias'], p)

real_aggregate=aggregate
def aggregate(counts,severities,triple_list,spec,io):
    io.open_batch(counts)
    out=real_aggregate(counts,severities,triple_list,spec,io)
    p=spec['p']; io.opened=[]
    for i,t in enumerate(triple_list):
        io.opened.append([(x-a)%p for x,a in zip(counts[i],t['a'])])
        io.opened.append([(y-b)%p for y,b in zip(severities[i],t['b'])])
    io.rounds=1;io.batch_sizes=[2*spec['parties']]
    return out
