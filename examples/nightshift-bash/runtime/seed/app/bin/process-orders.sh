#!/bin/bash
set -euo pipefail
# The controller invokes this entire script as the batch user.
source /srv/nightshift/app/config/runtime.env
inbox=/srv/nightshift/orders/inbox.csv
receipts=/srv/nightshift/orders/receipts.csv
rejected=/srv/nightshift/orders/rejected.csv
log=/srv/nightshift/logs/batch.log
[[ -f $inbox && -f $receipts && -f $rejected ]] || exit 1
# Calls are serialized by the trusted controller; retries see existing receipts.
while IFS= read -r line || [[ -n $line ]]; do
    [[ -n $line ]] || continue
    IFS=, read -r order_id quantity unit_price extra <<< "$line"
    commas=${line//[^,]/}
    if [[ ${#commas} -ne 2 || -n ${extra:-} || ! $order_id =~ ^[A-Za-z0-9-]{1,64}$ || ! $quantity =~ ^[0-9]{1,3}$ || ! $unit_price =~ ^[0-9]{1,6}$ ]]; then
        printf '%s,invalid-format\n' "$line" >> "$rejected"
        continue
    fi
    if (( 10#$quantity < 1 )); then
        printf '%s,invalid-quantity\n' "$line" >> "$rejected"
        continue
    fi
    # The ID alphabet excludes regular-expression metacharacters.
    if /usr/bin/grep -q "^${order_id}," "$receipts"; then
        continue
    fi
    # Deliberately unqualified executable: the participant investigates resolution.
    if receipt=$(render-receipt "$order_id" "$quantity" "$unit_price"); then
        printf '%s\n' "$receipt" >> "$receipts"
        printf '[batch] processed %s\n' "$order_id" >> "$log"
    else
        printf '[batch] failed %s\n' "$order_id" >> "$log"
        exit 1
    fi
done < "$inbox"
: > "$inbox"
