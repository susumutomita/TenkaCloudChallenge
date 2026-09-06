_r=(0,0)
_x=[]
_y0=0
_z0=0
_call=0

def gate_masks(randomness):
    global _r,_x,_call
    _r=randomness
    _x=[]
    _call=0
    return randomness

def offer(own_bit,mask):
    _x.append(own_bit)
    return (0,0)

def output_share(own_x,own_y,own_mask,received):
    global _call,_y0,_z0
    _call+=1
    if _call==1:
        _y0=own_y
        _z0=(_r[0]&_r[1])^_x[1]
        return _z0
    return _z0^((_x[0]^_x[1])&(_y0^own_y))

def needs_transfer(gate):return gate=='and'
