"""Regenerate 3d/js/meta/core/playerphotos.js from credits.json and the photo files on disk (safe to run any time)."""
import json
import os

import fetch_player_photos as F

with open(os.path.join(F.PLAYER_DIR, 'credits.json'), encoding='utf-8') as f:
    F.write_photos_js(json.load(f))
