# Real promo card data

12,738 cards from FIFA 22, FIFA 23, FC 24, FC 25, FC 26 and FC 27. Collected September 30, 2026.

Counts: {"FC24": 2063, "FC25": 2471, "FC26": 3342, "FC27": 104, "FIFA22": 1732, "FIFA23": 3026}

Sources: FUT.GG's public special-card listing and 14 public detail pages. Futbin and Futwiz public listings were also accessible through Firecrawl; FIFA 22 Premium FUTTIES Varane's six face stats matched all three sites. Coverage records every listing URL/page and supplemental source URL.

Every exported card has six numeric face stats read from a source. No ratings or stats were invented. Unknown metadata is null. ea_id identifies the EA card/item, not necessarily the underlying person's base EA ID. stats uses lowercase pac/sho/pas/dri/def/phy for outfield players and div/han/kic/ref/spd/pos for goalkeepers.

Excluded: Team of the Week, base common/rare/Icon/Hero and base CONMEBOL items, actual generated Evolutions, and provisional items. Included: promo subvariants, static academy starters, event tokens and World Cup players. Historical OTW rows mislabeled Total Rush Concept by the source are named using that source's Ones to Watch rarity group; their numbers are unchanged.

Coverage limits: all pages returned by each year's public special-card listing were collected. This cannot prove that the site's archive contains every historical release. FC 27 includes only currently published cards, not a completed future season. TOTS Warm-Up and Pre-Season have no separate new-card families here; re-releases remain under their original promo. No unresolved missing-stat cards remain among the returned items.

Game code is unchanged. Claude can review the JSON in data/promo_cards on branch chatgpt/real-promo-data before integrating it.

Resume/checkpoint tools and per-year coverage are included in the ZIP. Run python collect.py to resume an incomplete year, then python validate.py exports/promo_cards_*.json.
