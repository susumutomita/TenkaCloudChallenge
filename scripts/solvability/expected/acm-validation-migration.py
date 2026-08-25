"""Direct-answer mirror for acm-validation-migration.

``inventory`` is this problem's only direct-answer checkpoint (``preserve-identity`` through
``verify-renewal`` submit code and are audited by the `code` probe instead, driven by
``verifier/server.py``'s own ``CODE_CHECKPOINTS`` table). ``verifier.server`` already imports
``expected_inventory_answer`` from the fixture for its own grader, so the mirror calls the exact
same function the grader calls.
"""


def _inventory_expected(server, seed):
    return server.expected_inventory_answer(seed)


EXPECTED = {
    "inventory": _inventory_expected,
}


def _inventory_visible(server, seed):
    """What the player is actually looking at: `inventory_snapshot`, not the computed answer.

    Imported per call rather than at module scope: the audit purges and re-imports `fixtures`
    whenever the seed changes, so a module-level binding would go stale. `inventory_snapshot` is
    the Workbench's "Inspect evidence" payload; it is not re-exported from `verifier.server`
    because the participant reaches it through the Workbench container, not the hidden verifier.

    The five fields in `EXPECTED["inventory"]` are aggregates the player must derive (count
    domains across every certificate, tell which hosted zone owner is "self" vs. delegated,
    exclude already-DNS certificates) — none of them is a single value already sitting on
    screen. What *is* on screen is the raw evidence these fields are computed from, which is what
    this mirrors, so the leak probe is checking the right thing rather than skipping it.
    """
    from fixtures.aws_lab import inventory_snapshot

    account = inventory_snapshot(seed)
    all_domains = {
        domain
        for cert in account["certificates"]
        for domain in [cert["domainName"], *cert["sans"]]
    }
    return {
        "certificateCount": len(account["certificates"]),
        "certificateArns": sorted(cert["arn"] for cert in account["certificates"]),
        "certificateValidationMethods": {
            cert["arn"]: cert["validationMethod"] for cert in account["certificates"]
        },
        "totalDomainCount": len(all_domains),
        "hostedZoneOwnerByZoneId": {
            zone["id"]: zone["owner"] for zone in account["hostedZones"]
        },
        "consumerCount": len(account["consumers"]),
    }


VISIBLE = {
    "inventory": _inventory_visible,
}
