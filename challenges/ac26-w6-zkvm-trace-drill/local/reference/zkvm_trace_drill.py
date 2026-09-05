"""Author-only reference. The participant image does not contain this file."""

def exact(m, discounts):
    return sum(discounts)


def trace(m, discounts):
    acc=0
    result=[]
    for amount in discounts:
        acc=(acc+amount)%m
        result.append(acc)
    return result


def overflow(m, discounts):
    acc=0
    flags=[]
    for amount in discounts:
        full=acc+amount
        flags.append(full>=m)
        acc=full%m
    return flags


def decision(m, discounts, limit):
    full=sum(discounts)
    return full%m<=limit, full<=limit


def exploit(m, cases):
    answers=[]
    for case in cases:
        full=sum(case['discounts'])
        answers.append(full%m<=case['limit'] and full>case['limit'])
    return answers


def predicate(m, cases):
    answers=[]
    for case in cases:
        full=sum(case['discounts'])
        weak=full>case['limit']
        genuine=full%m<=case['limit'] and weak
        answers.append(weak and not genuine)
    return answers


def tamper(m, cases, reports):
    actual=exploit(m,cases)
    return [report==truth for report,truth in zip(reports,actual)]


def binding(program, receipts):
    return [r['verified'] and r['program']==program and r['claim']=='exploit' for r in receipts]
