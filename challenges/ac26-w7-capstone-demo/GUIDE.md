## Before you start

Use signed addition, subtraction, division and basic Python functions, lists and dictionaries. The remainder notation and required APIs are explained here.

## Your role and first submission

You build a program that adds people's private numbers without sending those numbers to the others. You will also build tests that find defects in it. This is a small secure-computation experiment: several people compute together while keeping their inputs private.

Here threshold means the group-size boundary where participants pooling their own inputs can recover the last person’s input from the total. With n people, n−1 people subtract their inputs from that total to obtain the remaining input.

Select Start → problem editor → Inspect evidence. Read setting (people, divisor, inputs) and vocabulary (property names). First edit only scope in capstone.py. Return PROVIDED as a list under claims, NOT_PROVIDED as a list under non_goals, setting.parties−1 under threshold, and setting.as_dict() under parameters. Submit scope; Solved is your first milestone. Use the table to explain why two properties are absent.

|Name|Meaning in this exercise|This construction|
|---|---|---|
|correctness|Following the rules produces the right sum|checked|
|privacy|The specified observed records do not distinguish two input examples|checked in a tiny experiment|
|soundness|Detect a participant lying about its input|not provided: inputs are not authenticated|
|availability|Finish when someone stops responding|not provided: everybody is awaited|

The same file is graded at eight checkpoints. test_the_scope_uses_the_known_vocabulary is the first public shape check. FAIL for later unimplemented functions is expected at this point. Run public tests checks your work; Submit grades it and a wrong submission costs 15 points. Finish with all eight Solved states.

## Inputs → shares → received sums → output

Write division remainder as `%`. For example, the remainder of −1 divided by7 is6: `(-1)%7 == 6`. All values below are reduced to0..p−1. Let p be the divisor and n the number of people, numbered0..n−1. A share is a part whose sum, reduced by p, recovers the original value.

To split input v, take the first n−1 parts from supplied random draws r; the last is `(v-sum(r))%p`. A uniform random value gives each allowed number equal probability. Here the selected numbers arrive as an argument; do not call random yourself.

```text
p=7, three people, inputs3,4,2
sender / recipient       0   1   2
0 (input3, draws1,2)      1   2   0   (3−1−2)%7=0
1 (input4, draws2,3)      2   3   6   (4−2−3)%7=6
2 (input2, draws4,1)      4   1   4   (2−4−1)%7=4
sum at each recipient    0   6   3   reduce each column sum
output=(0+6+3)%7=2=(3+4+2)%7
```

Call row i, column j s[i][j]. The published partial sum is t[j]=(s[0][j]+…+s[n−1][j])%p; output=(t[0]+…+t[n−1])%p. Adding the same parts by rows or by columns gives the same total. No matrix knowledge is needed.

Round1 sends shares; round2 publishes partial sums to everybody. rounds counts these waiting stages and is2. Record self-addressed messages too: n*n messages and n partial sums. measure must count the actual records, not simply return these formulas.

## Supplied API and input promises

The starter already imports the APIs below. You may add helper functions in capstone.py. Setting groups the parameters; read fields as setting.parties. Settings are valid: n≥2, p prime, inputs an integer tuple of length n with values0..p−1. Booleans are not integer values in this contract. A tuple is an ordered sequence such as `(1,2)`; a dict stores named values.

|API|Result or use|
|---|---|
|Setting(parties,modulus,inputs)|Build a setting, e.g. Setting(3,7,(3,4,2))|
|setting.randomness_length|n*(n−1)|
|setting.slice_for(i)|Pair start,end. Use `start,end=...; randomness[start:end]`; end is excluded. n=3,i=1 gives(2,4), the third and fourth entries|
|setting.as_dict()|{"parties":n,"modulus":p,"inputs":[…]}|
|sample_randomness(seed,setting)|Reproducible integer tuple of length n*(n−1). Use the supplied string seed unchanged|
|honest_sum(setting)|sum(setting.inputs)%p|
|tiny_settings()|Two n=3,p=3 settings with inputs(1,2,1) and(1,0,0); both sums are1|
|randomness_space(setting)|Every possible random tuple in order; use only for tiny settings. 3 to the sixth power=729 tuples|
|combinations(range(n),size)|All groups of that size; n=3,size=1 gives(0,),(1,),(2,)|
|CLAIMABLE / PROVIDED / NOT_PROVIDED|The four names / two checked properties / two absent properties. sorted(...) produces a list of names|

share receives exactly n−1 draws. run receives randomness with the proper length and range. For each i pass its slice to share. For example, record messages by increasing i, then increasing j, including self-messages; each(i,j) occurs exactly once.

## Return contracts and why each checkpoint follows

**correctness / transcript:** share returns an integer list of length n. run returns the dict below. output and every value are integers0..p−1, never bool; rounds is integer2. public is in recipient order. The optional from field on a public entry must equal its recipient index. Extra keys are allowed on run and its message/public records.

```python
{"output": 2,
 "messages": [{"from": 0, "to": 0, "value": 1}, ...],
 "public": [{"kind": "partial", "value": 0}, ...],
 "rounds": 2}
```

Here `...` abbreviates the remaining records; include every actual record in code. A right output can accompany duplicate addresses or partial sums inconsistent with received mail. transcript checks that the records describe a consistent run, including that each sender’s share sum recovers that sender’s input.

**privacy:** coalition is a tuple of distinct valid person indices who pool observations. view returns exactly the three keys below. received is a tuple of(from,to,value) triples, retaining only messages whose to is in the coalition and preserving their original order. public is the tuple of published values in original order; output is unchanged. Preserve values, duplicates and order.

```python
{"received": ((0,1,2),(1,1,3),(2,1,1)), "public": (0,6,3), "output": 2}
```

This is coalition=(1,) in the example. This exercise's view includes only received and public records, not the full adversary observation that also includes its inputs and sent randomness. An adversary means someone attempting to learn private inputs.

experiment_privacy returns `{"id":"exp-privacy","ran":True,"passed":a_bool,"space":729}`. Use n from tiny_settings, and for every group of size1..threshold(n)−1, and each of the two tiny settings, collect `repr(view(run(setting,r),coalition))` for every random tuple r into a list. repr turns Python data into a textual representation. Sort both lists and compare them. Do not use set, which discards multiplicity: [0,0,1] and[0,1,1] allow the same values but have different frequencies. passed is True only if every group's lists match. space counts the random tuples for one setting, not the combined count.

This is an exact comparison over729 tuples, two specified worlds and a restricted observation. It is not a proof for arbitrary inputs or a real system. Some groups have different own inputs between these worlds; no claim is made that their complete observations are identical.

**threshold:** threshold(n) returns n−1. Subtract the group's inputs from the output to find the last input. In the example, people0,1 compute `(2−3−4)%7=2`. recover returns None below n−1 members, otherwise `(observed["output"]-sum(setting.inputs[i] for i in coalition))%p`. Groups have at most n−1 members. Do not read outsiders' setting.inputs to supply the answer. This limit comes from the function being computed, not a protocol defect.

**detect:** detects(protocol) is the final application: build a test suite. protocol is called as protocol(setting,randomness). Return False for a correct implementation, True when you find a defect. Experiment with its records; do not inspect its name or code. The required rules are the output, record and observation rules above. For example, output2 and partial sums totalling3 can escape a check of only the reported output. You decide which inputs and random tuples to try and how to combine checks. A call raising an exception also indicates a defect. Grading uses previously unseen faults. This is not a decision procedure for every Python program.

**measure:** Execute run with sample_randomness(seed,setting). Return `{"rounds":transcript["rounds"],"messages":len(transcript["messages"]),"opened":len(transcript["public"]),"unit":nonempty_string,"environment":nonempty_string}`. Explain units as share deliveries including self-deliveries, and public partial sums. Name n,p and the single-process model in environment. These are not measured seconds or real network bandwidth.

**evidence:** Return a dict keyed by exactly the four properties; extra property keys are not allowed. Each row is `{"claimed":bool,"experiment":string,"verdict":bool_or_None,"limitation":nonempty_string}`. correctness/privacy are claimed=True and verdict is the result of the corresponding experiment (True on success). The other two use False/None and may have an empty experiment string. For correctness compare an actual run output with honest_sum; for privacy run experiment_privacy. Name each experiment with a nonempty id; state its tested range or absent guarantee in limitation. A report's shape is not itself evidence that the experiment ran. Explain the result alongside the individual grading checks.
