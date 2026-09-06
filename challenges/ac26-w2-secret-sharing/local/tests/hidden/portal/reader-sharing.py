def share(secret,n,p,randomness):
    head=[r%p for r in randomness[:n-1]]
    return head+[(secret-sum(head))%p]

def reconstruct(shares,p):
    return sum(shares)%p

def complete_shares(partial,secret,p):
    return (secret-sum(partial))%p

def rerandomize(shares,p,randomness):
    offsets=[r%p for r in randomness[:len(shares)-1]]
    offsets.append((-sum(offsets))%p)
    return [(shares[i]+offsets[i])%p for i in range(len(shares))]

def share_line(secret,p,randomness):
    return [[x,(secret+randomness[0]*x)%p] for x in (1,2,3)]

def reconstruct_line(two_points,p):
    x1,y1=two_points[0]
    x2,y2=two_points[1]
    d=(x2-x1)%p
    for k in range(1,p):
        if d*k%p==1:
            partner=k
            break
    slope=(y2-y1)*partner%p
    return (y1-slope*x1)%p
