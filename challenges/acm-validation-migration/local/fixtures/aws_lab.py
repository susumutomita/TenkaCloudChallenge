"""Deterministic, offline ACM + Route 53 simulator for the validation-method migration lab.

This module is the single source of truth for the fake AWS account that both the participant's
``migration.py`` and the hidden verifier operate against. It never touches a network or a real
AWS account: every certificate, hosted zone, consumer, and clock value is derived from a seed
string plus a named scenario, so a given ``(seed, scenario)`` pair always produces the same
account. Public tests, the reference implementation, the hidden checker, and the mutation suite
all import this module unmodified; only the seed and scenario name differ between them.

Simplifications this simulator makes relative to real ACM/Route 53 (documented so nobody mistakes
this for AWS behaviour):

- A wildcard domain (``*.example.com``) and its apex (``example.com``) get two independent
  validation records here. Real ACM sometimes shares one record across sibling domains depending
  on how the certificate was requested; that nuance is out of scope for this lab.
- Domain ownership is a flat ``domain -> hosted zone`` map handed to the participant via
  ``hosted_zone_for_domain``. Real Route 53 zone-apex matching (choosing the most specific zone
  for a name) is not modelled.
- IAM least privilege is enforced against ``declare_dns_write_policy`` documents that name Route 53
  actions and ``hostedzone/<id>`` resources only. Condition keys, SCPs, and cross-account roles are
  out of scope.
"""

from __future__ import annotations

import fnmatch
import hashlib
from typing import Callable, Optional

DEADLINE_HOURS = 72
DEADLINE_SECONDS = DEADLINE_HOURS * 3600
DEFAULT_PROPAGATION_SECONDS = 2 * 3600
DEFAULT_TICK_SECONDS = 3 * 3600
DEFAULT_MAX_TICKS = 30
START_TIME = 1_800_000_000  # arbitrary fixed epoch so every trace is reproducible

ALLOWED_DNS_ACTIONS = frozenset(
    {
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets",
        "route53:GetChange",
    }
)


class AccessDenied(Exception):
    """Raised when a Route 53 write/read is attempted outside the declared policy."""


class InvalidChangeBatch(Exception):
    """Raised when a CREATE targets a record that already exists (mirrors Route 53's own error)."""


def _digest(seed: str, label: str) -> str:
    return hashlib.sha256(f"{seed}:{label}".encode("utf-8")).hexdigest()


def _token(seed: str, label: str, width: int = 12) -> str:
    return _digest(seed, label)[:width]


def _cert_arn(seed: str, label: str) -> str:
    return f"arn:aws:acm:us-east-1:111122223333:certificate/{_token(seed, f'{label}:certarn', 16)}"


def _consumer_arn(seed: str, label: str, kind: str) -> str:
    suffix = _token(seed, f"{label}:consumer:{kind}", 10)
    if kind == "alb-listener":
        return f"arn:aws:elasticloadbalancing:us-east-1:111122223333:listener/app/{suffix}/50dc6c495c0c9188/f2f7dc8efc522ab2"
    if kind == "cloudfront-distribution":
        return f"arn:aws:cloudfront::111122223333:distribution/{suffix.upper()}"
    return f"arn:aws:apigateway:us-east-1::/domainnames/{suffix}.example.com"


def _zone_id(owner: str, ordinal: int) -> str:
    prefix = "ZSELF" if owner == "self" else "ZPARTNER"
    return f"{prefix}{ordinal:04d}"


def _base_domain(seed: str, scenario: str) -> str:
    return f"{_token(seed, f'{scenario}:base', 8)}.example.com"


def _domain_fqdn(seed: str, scenario: str, name: str) -> str:
    base = _base_domain(seed, scenario)
    if name == "@":
        return base
    if name == "*":
        return f"*.{base}"
    return f"{name}.{base}"


def _record_name(seed: str, domain: str) -> str:
    return f"_{_token(seed, f'{domain}:record-name', 32)}.{domain}."


def _record_value(seed: str, domain: str) -> str:
    return f"{_token(seed, f'{domain}:record-value', 32)}.acm-validations.aws."


# Recipes are structural (fixed shape); only the seed changes the concrete tokens (ARNs, domain
# names, hosted zone ids). "public" ships with the starter and public tests. "inventory" backs the
# inventory checkpoint's evidence. "retry" and "deadline" are hidden-only scenarios exercising slow
# propagation and a domain that never converges.
_RECIPE_CERTS: dict[str, list[dict]] = {
    "public": [
        {"key": "solo", "domains": [("api", "self")], "consumers": ["alb-listener"]},
        {
            "key": "done",
            "domains": [("static", "self")],
            "consumers": ["cloudfront-distribution"],
            "already_dns": True,
        },
    ],
    "inventory": [
        {
            "key": "cert-a",
            "domains": [("api", "self"), ("checkout", "partner"), ("*", "self"), ("@", "self")],
            "consumers": ["alb-listener", "cloudfront-distribution"],
        },
        {
            "key": "cert-b",
            "domains": [("static", "self")],
            "consumers": ["cloudfront-distribution"],
            "already_dns": True,
        },
        {"key": "cert-c", "domains": [("mail", "self")], "consumers": ["apigw-domain"]},
    ],
    "retry": [
        {
            "key": "slowpoke",
            "domains": [("app", "self"), ("slow", "self")],
            "consumers": ["alb-listener"],
            "propagation": {"slow": 30 * 3600},
        }
    ],
    "deadline": [
        {
            "key": "stuck",
            "domains": [("app", "self"), ("adversary", "partner")],
            "consumers": ["alb-listener"],
            "propagation": {"adversary": None},
        }
    ],
}


def _build_account(seed: str, scenario: str):
    recipe = _RECIPE_CERTS[scenario]
    certs: dict[str, dict] = {}
    domain_zone: dict[str, str] = {}
    zone_owner: dict[str, str] = {}
    zone_ids: dict[str, str] = {}
    consumers: list[dict] = []

    for spec in recipe:
        key = spec["key"]
        already_dns = bool(spec.get("already_dns", False))
        arn = _cert_arn(seed, f"{scenario}:{key}")
        pairs = spec["domains"]
        domain_names = [_domain_fqdn(seed, scenario, name) for name, _owner in pairs]
        primary, *sans = domain_names
        overrides = spec.get("propagation", {})

        validations: dict[str, dict] = {}
        for (name, owner), fqdn in zip(pairs, domain_names):
            if owner not in zone_ids:
                zone_ids[owner] = _zone_id(owner, len(zone_ids))
                zone_owner[zone_ids[owner]] = owner
            zone_id = zone_ids[owner]
            domain_zone[fqdn] = zone_id
            propagation = overrides.get(name, DEFAULT_PROPAGATION_SECONDS)
            validations[fqdn] = {
                "domain": fqdn,
                "zoneId": zone_id,
                "status": "SUCCESS" if already_dns else "PENDING_VALIDATION",
                "recordName": _record_name(seed, fqdn) if already_dns else "",
                "recordValue": _record_value(seed, fqdn) if already_dns else "",
                "publishedAt": START_TIME if already_dns else None,
                "propagationSeconds": propagation,
            }

        certs[arn] = {
            "arn": arn,
            "domainName": primary,
            "sans": sans,
            "method": "DNS" if already_dns else "EMAIL",
            "optionsUpdatedAt": START_TIME if already_dns else None,
            "validations": validations,
        }
        for kind in spec.get("consumers", []):
            consumers.append(
                {
                    "resourceArn": _consumer_arn(seed, f"{scenario}:{key}", kind),
                    "certificateArn": arn,
                    "kind": kind,
                }
            )

    return certs, domain_zone, zone_owner, consumers


class AwsLab:
    """A small, in-process fake of the ACM + Route 53 surface this migration needs."""

    def __init__(self, seed: str, scenario: str) -> None:
        if scenario not in _RECIPE_CERTS:
            raise ValueError(f"unknown scenario: {scenario}")
        self._seed = seed
        self._scenario = scenario
        self._now = START_TIME
        self._certs, self._domain_zone, self._zone_owner, self._consumers = _build_account(
            seed, scenario
        )
        self._records: dict[tuple[str, str, str], str] = {}
        self._policy: Optional[list[dict]] = None
        self._log: list[dict] = []

    # ---- time -----------------------------------------------------------------------------
    def now(self) -> int:
        return self._now

    def deadline_seconds(self) -> int:
        """Seconds a certificate has, from its method switch, to get every domain validated.

        Exposed on the client (rather than requiring ``import fixtures.aws_lab``) because the
        hidden verifier runs a submitted ``migration.py`` in isolation, with only the standard
        library and this ``client`` argument available to it.
        """
        return DEADLINE_SECONDS

    def advance_time(self, seconds: int) -> None:
        if seconds < 0:
            raise ValueError("time does not go backwards")
        self._now += seconds

    # ---- read-only inventory ----------------------------------------------------------------
    def list_certificates(self) -> list[dict]:
        return [self._cert_view(cert) for cert in self._certs.values()]

    def list_hosted_zones(self) -> list[dict]:
        by_zone: dict[str, list[str]] = {}
        for domain, zone_id in self._domain_zone.items():
            by_zone.setdefault(zone_id, []).append(domain)
        return [
            {"id": zone_id, "owner": self._zone_owner[zone_id], "domains": sorted(domains)}
            for zone_id, domains in by_zone.items()
        ]

    def list_consumers(self) -> list[dict]:
        return [dict(consumer) for consumer in self._consumers]

    def hosted_zone_for_domain(self, domain: str) -> Optional[str]:
        return self._domain_zone.get(domain)

    # ---- ACM-like API -----------------------------------------------------------------------
    def describe_certificate(self, arn: str) -> dict:
        cert = self._require_cert(arn)
        self._log_call("describe_certificate", arn=arn)
        return self._cert_view(cert)

    def list_certificate_domain_validations(self, arn: str) -> list[dict]:
        cert = self._require_cert(arn)
        self._log_call("list_certificate_domain_validations", arn=arn)
        views = []
        for dv in cert["validations"].values():
            record = None
            if cert["method"] == "DNS" and dv["recordName"]:
                record = {"name": dv["recordName"], "type": "CNAME", "value": dv["recordValue"]}
            views.append(
                {
                    "domainName": dv["domain"],
                    "validationStatus": self._status(dv),
                    "resourceRecord": record,
                }
            )
        return views

    def update_certificate_options(self, arn: str, validation_method: str) -> dict:
        if validation_method != "DNS":
            raise ValueError("this lab only models switching TO DNS validation")
        cert = self._require_cert(arn)
        self._log_call("update_certificate_options", arn=arn, validationMethod=validation_method)
        if cert["method"] != "DNS":
            cert["method"] = "DNS"
            cert["optionsUpdatedAt"] = self._now
            for dv in cert["validations"].values():
                dv["recordName"] = _record_name(self._seed, dv["domain"])
                dv["recordValue"] = _record_value(self._seed, dv["domain"])
        return self._cert_view(cert)

    def request_certificate(
        self,
        domain_name: str,
        subject_alternative_names: tuple[str, ...] = (),
        validation_method: str = "DNS",
    ) -> dict:
        """Mint a brand-new certificate ARN.

        This call succeeds, exactly like the real API would. It is modelled here only because a
        migration runbook could plausibly reach for it by mistake; the checkpoints that care about
        certificate identity fail a submission that ever calls it, not because the simulator
        refuses the call.
        """
        self._log_call(
            "request_certificate", domainName=domain_name, sans=list(subject_alternative_names)
        )
        arn = _cert_arn(
            self._seed, f"{self._scenario}:replacement:{domain_name}:{len(self._certs)}"
        )
        domains = [domain_name, *subject_alternative_names]
        validations = {
            domain: {
                "domain": domain,
                "zoneId": self._domain_zone.get(domain, ""),
                "status": "PENDING_VALIDATION",
                "recordName": _record_name(self._seed, domain) if validation_method == "DNS" else "",
                "recordValue": (
                    _record_value(self._seed, domain) if validation_method == "DNS" else ""
                ),
                "publishedAt": None,
                "propagationSeconds": DEFAULT_PROPAGATION_SECONDS,
            }
            for domain in domains
        }
        self._certs[arn] = {
            "arn": arn,
            "domainName": domain_name,
            "sans": list(subject_alternative_names),
            "method": validation_method,
            "optionsUpdatedAt": self._now if validation_method == "DNS" else None,
            "validations": validations,
        }
        return self._cert_view(self._certs[arn])

    def delete_certificate(self, arn: str) -> None:
        self._require_cert(arn)
        self._log_call("delete_certificate", arn=arn)
        del self._certs[arn]

    # ---- least-privilege DNS write policy -----------------------------------------------------
    def declare_dns_write_policy(self, statements: list[dict]) -> None:
        if not isinstance(statements, list) or not statements:
            raise ValueError("statements must be a non-empty list of policy statements")
        for statement in statements:
            if not isinstance(statement, dict) or not {"Effect", "Action", "Resource"} <= set(
                statement
            ):
                raise ValueError("each statement needs Effect, Action, and Resource")
        self._log_call("declare_dns_write_policy", statements=statements)
        self._policy = statements

    def debug_policy(self) -> Optional[list[dict]]:
        return self._policy

    def _authorized(self, action: str, zone_id: str) -> bool:
        # Real IAM evaluates a wildcard resource pattern as authorizing the call, even though
        # that breadth is exactly what the least-privilege checkpoint later flags as a mistake.
        # A policy that is too broad still works; a policy that is too narrow blocks progress.
        if not self._policy:
            return False
        resource = f"arn:aws:route53:::hostedzone/{zone_id}"
        for statement in self._policy:
            if statement.get("Effect") != "Allow":
                continue
            actions = statement.get("Action", [])
            actions = [actions] if isinstance(actions, str) else actions
            if action not in actions:
                continue
            resources = statement.get("Resource", [])
            resources = [resources] if isinstance(resources, str) else resources
            if any(fnmatch.fnmatchcase(resource, pattern) for pattern in resources):
                return True
        return False

    # ---- Route 53-like API ---------------------------------------------------------------------
    def change_resource_record_sets(
        self, hosted_zone_id: str, action: str, record_name: str, record_type: str, record_value: str
    ) -> dict:
        if action not in ("CREATE", "UPSERT"):
            raise ValueError("action must be CREATE or UPSERT")
        if not self._authorized("route53:ChangeResourceRecordSets", hosted_zone_id):
            raise AccessDenied(f"not authorized to write to hosted zone {hosted_zone_id}")
        key = (hosted_zone_id, record_name, record_type)
        exists = key in self._records
        self._log_call(
            "change_resource_record_sets",
            zoneId=hosted_zone_id,
            action=action,
            name=record_name,
            type=record_type,
            value=record_value,
        )
        if action == "CREATE" and exists:
            raise InvalidChangeBatch(
                f"record {record_name} already exists in hosted zone {hosted_zone_id}"
            )
        self._records[key] = record_value
        self._apply_record_effects(hosted_zone_id, record_name, record_type, record_value)
        return {
            "changeId": f"C{_token(self._seed, f'change:{hosted_zone_id}:{record_name}:{self._now}', 10).upper()}",
            "status": "INSYNC",
        }

    def list_resource_record_sets(self, hosted_zone_id: str) -> list[dict]:
        if not self._authorized("route53:ListResourceRecordSets", hosted_zone_id):
            raise AccessDenied(f"not authorized to read hosted zone {hosted_zone_id}")
        return [
            {"name": name, "type": rtype, "value": value}
            for (zone_id, name, rtype), value in self._records.items()
            if zone_id == hosted_zone_id
        ]

    def _apply_record_effects(
        self, zone_id: str, name: str, record_type: str, value: str
    ) -> None:
        if record_type != "CNAME":
            return
        for cert in self._certs.values():
            for dv in cert["validations"].values():
                if dv["zoneId"] == zone_id and dv["recordName"] == name:
                    if value == dv["recordValue"] and dv["publishedAt"] is None:
                        dv["publishedAt"] = self._now

    # ---- introspection (harmless self-audit; no secret is behind these) ------------------------
    def call_log(self) -> list[dict]:
        return [dict(entry) for entry in self._log]

    def debug_validation_state(self, arn: str) -> dict[str, dict]:
        cert = self._require_cert(arn)
        return {
            domain: {"correctlyPublished": dv["publishedAt"] is not None, "status": self._status(dv)}
            for domain, dv in cert["validations"].items()
        }

    # ---- internals -----------------------------------------------------------------------------
    def _require_cert(self, arn: str) -> dict:
        cert = self._certs.get(arn)
        if cert is None:
            raise ValueError(f"no such certificate: {arn}")
        return cert

    def _log_call(self, op: str, **fields: object) -> None:
        self._log.append({"op": op, "at": self._now, **fields})

    def _status(self, dv: dict) -> str:
        if (
            dv["status"] != "SUCCESS"
            and dv["publishedAt"] is not None
            and dv["propagationSeconds"] is not None
            and self._now >= dv["publishedAt"] + dv["propagationSeconds"]
        ):
            dv["status"] = "SUCCESS"
        return dv["status"]

    def _renewal_eligibility(self, cert: dict) -> str:
        if cert["method"] != "DNS":
            return "INELIGIBLE"
        return (
            "ELIGIBLE"
            if all(self._status(dv) == "SUCCESS" for dv in cert["validations"].values())
            else "INELIGIBLE"
        )

    def _cert_view(self, cert: dict) -> dict:
        return {
            "arn": cert["arn"],
            "domainName": cert["domainName"],
            "sans": list(cert["sans"]),
            "validationMethod": cert["method"],
            "optionsUpdatedAt": cert["optionsUpdatedAt"],
            "renewalEligibility": self._renewal_eligibility(cert),
        }


StepFn = Callable[[AwsLab], dict]


def drive(
    client: AwsLab,
    step_fn: StepFn,
    *,
    max_ticks: int = DEFAULT_MAX_TICKS,
    tick_seconds: int = DEFAULT_TICK_SECONDS,
) -> tuple[Optional[dict], list[dict]]:
    """Call ``step_fn`` repeatedly, advancing the fake clock between calls.

    This is the scheduler a real migration would run under (a Lambda on a cron, a state machine
    on a timer): each call is one idempotent tick. The loop stops once every certificate the tick
    reported has settled (``done`` or ``aborted``), or after ``max_ticks`` ticks with no resolution.
    Returns the last result (or ``None`` if ``step_fn`` was never called) and the full history.
    """
    history: list[dict] = []
    result: Optional[dict] = None
    for _ in range(max_ticks):
        result = step_fn(client)
        history.append(result)
        certs = result.get("certificates", {}) if isinstance(result, dict) else {}
        if certs and all(c.get("done") or c.get("aborted") for c in certs.values()):
            return result, history
        client.advance_time(tick_seconds)
    return result, history


def health_token(seed: str) -> str:
    return f"acm-lab-{_token(seed, 'health', 12)}"


def inventory_snapshot(seed: str) -> dict:
    """Participant-visible evidence for the inventory checkpoint. Safe to expose in full."""
    client = AwsLab(seed, "inventory")
    certificates = []
    for cert in client.list_certificates():
        validations = client.list_certificate_domain_validations(cert["arn"])
        certificates.append(
            {
                **cert,
                "domainValidations": [
                    {"domainName": v["domainName"], "validationStatus": v["validationStatus"]}
                    for v in validations
                ],
            }
        )
    return {
        "certificates": certificates,
        "hostedZones": client.list_hosted_zones(),
        "consumers": client.list_consumers(),
    }


def expected_inventory_answer(seed: str) -> dict:
    client = AwsLab(seed, "inventory")
    certs = client.list_certificates()
    zones = {zone["id"]: zone for zone in client.list_hosted_zones()}
    all_domains: set[str] = set()
    delegated_domains: set[str] = set()
    for cert in certs:
        for domain in [cert["domainName"], *cert["sans"]]:
            all_domains.add(domain)
            zone_id = client.hosted_zone_for_domain(domain)
            if zones.get(zone_id, {}).get("owner") != "self":
                delegated_domains.add(domain)
    return {
        "certificateCount": len(certs),
        "totalDomainCount": len(all_domains),
        "delegatedDomainCount": len(delegated_domains),
        "dependentCount": len(client.list_consumers()),
        "certificatesNeedingMigration": sorted(
            cert["arn"] for cert in certs if cert["validationMethod"] != "DNS"
        ),
    }


# Every question the participant is asked, in one place, mirroring the convention other local-play
# problems in this catalog use (Japanese is the default; English lives under i18n.en).
QUESTIONS = {
    "inventory": {
        "question": (
            "証拠 (evidence) に載っている証明書・SAN・依存先・DNS の管理者 (owner) を読み、"
            "次の5つの値をJSONで答えてください。"
        ),
        "answerFormat": (
            '{"certificateCount": <int>, "totalDomainCount": <int>, '
            '"delegatedDomainCount": <int>, "dependentCount": <int>, '
            '"certificatesNeedingMigration": ["<arn>", ...] (昇順、DNS検証済みの証明書は含めない)}'
        ),
        "i18n": {
            "en": {
                "question": (
                    "Read the certificates, SANs, dependents, and DNS owners in the evidence, "
                    "then answer these five values as JSON."
                ),
                "answerFormat": (
                    '{"certificateCount": <int>, "totalDomainCount": <int>, '
                    '"delegatedDomainCount": <int>, "dependentCount": <int>, '
                    '"certificatesNeedingMigration": ["<arn>", ...] (ascending, exclude '
                    "already-DNS-validated certificates)}"
                ),
            }
        },
    }
}
