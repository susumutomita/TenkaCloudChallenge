# ans-nacl-ephemeral

**ANS-C01 · flag · difficulty 4 · $0**

## Story

CTO Sasaki-san reports that HTTPS responses never arrive at clients despite inbound TCP 443 being allowed in the NACL. Kato-san forgot that NACLs are stateless and left the outbound ephemeral port range out of the rules.

## What gets deployed

- 1 VPC (10.50.0.0/16)
- 1 Network ACL with:
  - Inbound rule 100: allow TCP 443 from `0.0.0.0/0`
  - Inbound rule 32766: deny all
  - Outbound rule 100: allow TCP 443 to `0.0.0.0/0` (misdirection — this is NOT how return traffic works)
  - Outbound rule 32766: deny all (ephemeral range intentionally missing)
- 1 subnet associated with the NACL
- 1 SSM Parameter (`/{NamePrefix}/briefing`)

No EC2, NAT Gateway, or EIP. Cost: **$0**.

## Solution

**Flag:** `TC{1024-65535}`

NACLs are stateless. A TCP client connects from a random ephemeral source port (1024–65535). The server's response must be sent **to that client's ephemeral port**. If the outbound NACL rule does not allow ports 1024–65535, the response is dropped, even though inbound 443 is allowed.

CLI to verify:
```bash
aws ec2 describe-network-acls \
  --filters "Name=tag:TenkaCloud:NamePrefix,Values=${NAME_PREFIX}" \
  --query "NetworkAcls[].Entries[?Egress==\`true\`]"
```

The player will observe that outbound allows only port 443 and deny-all — the ephemeral range 1024–65535 is absent.

Security Group comparison: SGs are stateful — return traffic is automatically allowed. NACLs require explicit bidirectional rules.

## Scoring

- Correct: **+200 pt**
- Wrong: **−15 pt** per attempt

## Learning goals

1. Understand that NACLs are stateless and require explicit outbound ephemeral port rules
2. Distinguish Security Group (stateful) from NACL (stateless) return-traffic handling
3. Know the ephemeral port range (1024–65535) used for TCP client source ports
