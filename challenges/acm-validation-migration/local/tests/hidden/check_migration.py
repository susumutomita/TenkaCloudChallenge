"""Hidden property checks for the five code checkpoints.

Each function is cumulative, the same shape this catalog already uses for multi-property
container labs: a later checkpoint re-checks every earlier property and adds its own, so a
submission cannot pass ``verify-renewal`` while quietly failing ``preserve-identity``.
"""

from __future__ import annotations

from types import ModuleType

from fixtures.aws_lab import DEADLINE_SECONDS, AwsLab, drive

FORBIDDEN_OPS = frozenset({"request_certificate", "delete_certificate"})
TICK_SECONDS = 3 * 3600
MAX_TICKS_WITHIN_DEADLINE = (DEADLINE_SECONDS // TICK_SECONDS) + 2  # a little headroom past 72h


def _step(module: ModuleType):
    def call(client: AwsLab) -> dict:
        return module.migrate_step(client)

    return call


def _needs_migration_arns(client: AwsLab) -> set[str]:
    return {cert["arn"] for cert in client.list_certificates() if cert["validationMethod"] != "DNS"}


def _preserve_identity_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures: list[str] = []
    client = AwsLab(f"{seed}:{phase}", "inventory")
    original_arns = sorted(cert["arn"] for cert in client.list_certificates())
    original_consumers = client.list_consumers()

    drive(client, _step(module), max_ticks=MAX_TICKS_WITHIN_DEADLINE, tick_seconds=TICK_SECONDS)

    forbidden_calls = [entry for entry in client.call_log() if entry["op"] in FORBIDDEN_OPS]
    if forbidden_calls:
        failures.append(
            "migrate_step called "
            + ", ".join(sorted({entry["op"] for entry in forbidden_calls}))
            + " instead of migrating the existing certificate in place"
        )
    if sorted(cert["arn"] for cert in client.list_certificates()) != original_arns:
        failures.append("the set of certificate ARNs changed")
    if client.list_consumers() != original_consumers:
        failures.append("a consumer's certificateArn changed")
    return failures


def _publish_records_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _preserve_identity_properties(module, seed, phase)
    client = AwsLab(f"{seed}:{phase}", "inventory")
    already_dns = {
        cert["arn"] for cert in client.list_certificates() if cert["validationMethod"] == "DNS"
    }
    needs_migration = _needs_migration_arns(client)

    # A short budget: this checks that the *correct records were written*, not that they have
    # finished propagating yet (that is verify-renewal's job).
    drive(client, _step(module), max_ticks=2, tick_seconds=TICK_SECONDS)

    for arn in needs_migration:
        state = client.debug_validation_state(arn)
        for domain, info in state.items():
            if not info["correctlyPublished"]:
                failures.append(
                    f"{domain} did not receive the correct CNAME name/value in its own hosted zone"
                )
    for arn in already_dns:
        state = client.debug_validation_state(arn)
        if not all(info["correctlyPublished"] for info in state.values()):
            failures.append("a certificate that was already DNS-validated lost its record state")
    return failures


def _least_privilege_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _publish_records_properties(module, seed, phase)
    client = AwsLab(f"{seed}:{phase}", "inventory")
    needs_migration = _needs_migration_arns(client)
    needed_zone_ids: set[str] = set()
    for arn in needs_migration:
        cert = client.describe_certificate(arn)
        for domain in [cert["domainName"], *cert["sans"]]:
            zone_id = client.hosted_zone_for_domain(domain)
            if zone_id is not None:
                needed_zone_ids.add(zone_id)

    drive(client, _step(module), max_ticks=2, tick_seconds=TICK_SECONDS)

    statements = client.debug_policy()
    if not statements:
        failures.append("no DNS write policy was declared")
        return failures

    actions: set[str] = set()
    resources: set[str] = set()
    for statement in statements:
        if statement.get("Effect") != "Allow":
            continue
        raw_actions = statement.get("Action", [])
        raw_resources = statement.get("Resource", [])
        actions.update([raw_actions] if isinstance(raw_actions, str) else raw_actions)
        resources.update([raw_resources] if isinstance(raw_resources, str) else raw_resources)

    allowed_actions = {"route53:ChangeResourceRecordSets", "route53:ListResourceRecordSets", "route53:GetChange"}
    if not actions or not actions <= allowed_actions:
        failures.append("policy actions are not limited to the documented Route 53 read/write actions")

    zone_prefix = "arn:aws:route53:::hostedzone/"
    wildcard_resources = {
        resource for resource in resources if "*" in resource or not resource.startswith(zone_prefix)
    }
    if wildcard_resources:
        failures.append("policy resource is not restricted to specific hosted zones")

    specific_resources = resources - wildcard_resources
    granted_zone_ids = {resource[len(zone_prefix) :] for resource in specific_resources}
    if granted_zone_ids - needed_zone_ids:
        failures.append("policy grants access to a hosted zone this migration does not use")
    if needed_zone_ids - granted_zone_ids:
        failures.append("policy is missing a hosted zone this migration needs")
    return failures


def _deadline_retry_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _least_privilege_properties(module, seed, phase)

    # Positive: slow propagation still converges to done well inside the 72-hour deadline.
    retry_client = AwsLab(f"{seed}:{phase}", "retry")
    [target_arn] = [
        cert["arn"] for cert in retry_client.list_certificates() if cert["validationMethod"] != "DNS"
    ]
    final, _history = drive(
        retry_client, _step(module), max_ticks=MAX_TICKS_WITHIN_DEADLINE, tick_seconds=TICK_SECONDS
    )
    entry = (final or {}).get("certificates", {}).get(target_arn, {})
    if not entry.get("done"):
        failures.append("a certificate with slow-propagating domains never converged to done")

    # An extra idempotent tick with no time elapsed must not raise or duplicate side effects.
    try:
        repeat = module.migrate_step(retry_client)
    except Exception as error:  # noqa: BLE001 - a raising retry is a failed property
        failures.append(f"an idempotent extra tick raised {type(error).__name__}")
    else:
        if not isinstance(repeat, dict) or "certificates" not in repeat:
            failures.append("an idempotent extra tick did not return the documented shape")

    # Negative: a domain that never validates must abort at the deadline, not loop past it or
    # claim done.
    deadline_client = AwsLab(f"{seed}:{phase}", "deadline")
    [stuck_arn] = [
        cert["arn"] for cert in deadline_client.list_certificates() if cert["validationMethod"] != "DNS"
    ]
    done_seen = False
    aborted_seen = False
    wrote_past_deadline = False
    for _ in range(MAX_TICKS_WITHIN_DEADLINE + 5):
        before = len(
            [entry for entry in deadline_client.call_log() if entry["op"] == "change_resource_record_sets"]
        )
        result = module.migrate_step(deadline_client)
        after = len(
            [entry for entry in deadline_client.call_log() if entry["op"] == "change_resource_record_sets"]
        )
        cert_state = (result or {}).get("certificates", {}).get(stuck_arn, {})
        if cert_state.get("done"):
            done_seen = True
        if cert_state.get("aborted"):
            aborted_seen = True
        options_updated_at = deadline_client.describe_certificate(stuck_arn)["optionsUpdatedAt"]
        past_deadline = (
            options_updated_at is not None
            and deadline_client.now() >= options_updated_at + DEADLINE_SECONDS
        )
        if past_deadline and after > before:
            wrote_past_deadline = True
        deadline_client.advance_time(TICK_SECONDS)

    if done_seen:
        failures.append("a certificate with a domain that never validates was reported done")
    if not aborted_seen:
        failures.append("migrate_step never reported aborted once the 72-hour deadline passed")
    if wrote_past_deadline:
        failures.append("migrate_step kept writing DNS records after the 72-hour deadline passed")
    return failures


def _verify_renewal_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    failures = _deadline_retry_properties(module, seed, phase)

    client = AwsLab(f"{seed}:{phase}", "inventory")
    final, _history = drive(
        client, _step(module), max_ticks=MAX_TICKS_WITHIN_DEADLINE, tick_seconds=TICK_SECONDS
    )
    reported = (final or {}).get("certificates", {})
    for cert in client.list_certificates():
        arn = cert["arn"]
        if not reported.get(arn, {}).get("done"):
            failures.append(f"{arn} was never reported done in the basic multi-domain scenario")

        # Independent re-query: never trust the returned dict's claim on its own.
        view = client.describe_certificate(arn)
        if view["validationMethod"] != "DNS":
            failures.append(f"{arn} was not left on DNS validation")
        validations = client.list_certificate_domain_validations(arn)
        if not validations or not all(v["validationStatus"] == "SUCCESS" for v in validations):
            failures.append(f"{arn} has a domain that is not independently confirmed SUCCESS")
        if view["renewalEligibility"] != "ELIGIBLE":
            failures.append(f"{arn} is not independently confirmed renewal-eligible")
    return failures


def check_preserve_identity(module: ModuleType, seed: str) -> list[str]:
    return _preserve_identity_properties(module, seed, "preserve-identity-checkpoint")


def check_publish_records(module: ModuleType, seed: str) -> list[str]:
    return _publish_records_properties(module, seed, "publish-records-checkpoint")


def check_least_privilege(module: ModuleType, seed: str) -> list[str]:
    return _least_privilege_properties(module, seed, "least-privilege-checkpoint")


def check_deadline_retry(module: ModuleType, seed: str) -> list[str]:
    return _deadline_retry_properties(module, seed, "deadline-retry-checkpoint")


def check_verify_renewal(module: ModuleType, seed: str) -> list[str]:
    return _verify_renewal_properties(module, seed, "verify-renewal-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _verify_renewal_properties(module, seed, "full-run")
