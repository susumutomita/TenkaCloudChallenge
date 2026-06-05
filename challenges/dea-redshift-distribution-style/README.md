# dea-redshift-distribution-style — DEA · flag · difficulty 3 · $0

## Story

Kato-san designed a Redshift fact table that is frequently joined on `customer_id`. CTO Sasaki-san asks which distribution style minimizes data movement during JOIN. The player reads the scenario and selects between ALL, EVEN, and KEY.

## What gets deployed

- 1 SSM Parameter (`/{NamePrefix}/briefing`) with the scenario

No Redshift cluster deployed (min $0.25/h). $0 cost.

## Solution

**Flag:** `TC{key}`

KEY distribution places rows with the same distribution key value on the same slice. When the fact table and dimension table share the same distribution key (`customer_id`), joined rows are co-located, eliminating cross-node data redistribution.

- ALL: duplicates the entire table to every node — suitable for small dimension tables, not large fact tables
- EVEN: round-robin — no join optimization, maximizes redistribution overhead
- KEY: co-locates rows by key value — minimizes JOIN data movement for large fact tables

## Scoring

- Correct: +200 pt
- Wrong: -20 pt/attempt (anti-brute-force)
- Hint 1: -20 pt (eliminates ALL and EVEN)
- Hint 2: -40 pt (reveals answer)

## Learning goals

- Understand Redshift distribution styles: ALL, EVEN, KEY
- Explain why KEY distribution minimizes data movement for large fact table JOINs
- Understand redistribution cost and distribution style selection criteria
