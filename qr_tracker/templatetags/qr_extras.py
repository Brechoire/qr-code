"""Filtres d'affichage des pages stats."""

from __future__ import annotations

import hashlib

from django import template

register = template.Library()


@register.filter
def cat_style(name: str) -> str:
    """Couleur de badge déterministe par nom de catégorie (fond pastel, texte sombre)."""
    digest = hashlib.md5(str(name or "").lower().encode()).hexdigest()
    hue = int(digest[:4], 16) % 360
    return (
        f"background:hsl({hue},55%,93%);border-color:hsl({hue},45%,72%);"
        f"color:hsl({hue},55%,26%)"
    )
