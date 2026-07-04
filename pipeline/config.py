"""Tunable thresholds for the Taste Test data pipeline.

Keeping these as named constants (not magic numbers buried in a query)
makes the notability floor auditable and re-tunable without touching
pipeline/materialize.py.
"""

# Notability floor: minimum ListenBrainz distinct-listener count
# (stg_popularity.listener_count) a release-group needs to enter the
# materialized album universe (see pipeline/materialize.py).
#
# Concrete starting default per 01-03-PLAN.md's <notability_floor> block:
# on the ListenBrainz user base, >= 50 distinct listeners is a defensible
# "notable" cut, expected to land the surviving album count in the tens
# of thousands -- a starting value, not a guess left blank. It MUST be
# re-tuned against the real dump: run `materialize.py --verify`, read the
# printed total album count, and raise/lower this constant until the
# count lands in the ~20,000-100,000 target band. See pipeline/README.md
# "Re-tuning NOTABILITY_MIN_LISTENERS" for the exact loop.
NOTABILITY_MIN_LISTENERS = 50
