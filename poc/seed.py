"""Seed artists for the clustering POC.

~30 artists across deliberately distinct pockets so community detection has
real structure to recover. If the similarity graph collapses these into one
blob, that is itself a finding. Names are chosen to be unambiguous on
MusicBrainz (avoid generic one-word names that collide).
"""

SEED = [
    # butt rock / post-grunge (the marquee anchor lane from PRODUCT.md)
    "Creed", "Nickelback", "3 Doors Down", "Puddle of Mudd", "Staind",
    # 90s grunge proper (should be adjacent to but distinct from butt rock)
    "Nirvana", "Pearl Jam", "Soundgarden", "Alice in Chains",
    # Y2K teen pop
    "Britney Spears", "*NSYNC", "Backstreet Boys", "Christina Aguilera",
    # classic hip-hop
    "Nas", "Jay-Z", "The Notorious B.I.G.", "Wu-Tang Clan",
    # indie / art rock 2000s
    "Arcade Fire", "The Strokes", "Interpol", "Modest Mouse",
    # electronic / EDM
    "Daft Punk", "The Chemical Brothers", "Aphex Twin",
    # metal
    "Metallica", "Slayer", "Megadeth",
    # attribute-lane bait: bands with foods in the name (cross-genre on purpose)
    "Cake", "Korn", "Bread", "Smashing Pumpkins",
]
