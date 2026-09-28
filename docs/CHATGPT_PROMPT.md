# Prompt for ChatGPT (data work, paste as-is)

You're helping with a browser soccer game (FIFA/FC Ultimate Team style). I need DATA only, no code. Output plain JSON arrays I can paste in. Be accurate; if you don't know a fact, put null — never invent.

1) Egypt 2026 World Cup squad (26 players, latest known) + 15 best Egyptian players ever (e.g. Salah, Aboutrika, Hossam Hassan, Essam El-Hadary, Hany Ramzy, Ahmed Hassan, Wael Gomaa, Mido, Zidan, Hazem Emam, Trezeguet, Elneny...).
   Row format: ["id_lowercase_nospaces","Full Name","Surname","EGY","MAINPOS",["ALT1","ALT2"],"R|L foot",OVR,age_or_null,skillMoves1to5,"club or LEGEND"]
   Positions: GK CB LB RB LWB RWB CDM CM CAM LM RM LW RW ST CF. Legends rated at their peak (OVR 80–93 range, realistic).
   Exclude anyone who has died (e.g. Ahmed Refaat).
2) Bios for those players: {"id": "DOB YYYY-MM-DD|height_cm|foot"} — null for unknown parts.
3) 60 short football commentary lines split by event: goal, long-range goal, header goal, save, miss, foul, yellow card, red card, kickoff, half time, full time. Max 12 words each, no em dashes, no cringe.
4) FUT Draft odds suggestion: for a 5-card pick, a table of rating bands (75–79, 80–84, 85–87, 88–90, 91+) with probabilities that make a strong squad possible but not guaranteed; captain pick separately.

Return each section as its own code block.
