"""Utilitaires : hash RGPD, détection bots, validation cibles."""

from __future__ import annotations

import hashlib

from django.conf import settings


BOT_KEYWORDS = ("bot", "crawl", "spider", "slurp", "mediapartners", "baidu", "yandex", "sogou")


def hash_ip(ip: str) -> str:
    """Hash SHA-256 de l'IP + sel (on ne stocke jamais l'IP en clair)."""
    salt = settings.QR_TRACKER_IP_HASH_SALT  # requis au démarrage, jamais de défaut
    raw = f"{salt}|{ip or ''}".encode()
    return hashlib.sha256(raw).hexdigest()


def get_client_ip(request) -> str:
    """IP cliente en tenant compte d'un éventuel proxy (X-Forwarded-For)."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def is_bot(user_agent: str) -> bool:
    ua = (user_agent or "").lower()
    return any(k in ua for k in BOT_KEYWORDS)


def is_allowed_target_url(url: str) -> bool:
    """N'autorise que http/https externes (anti open-redirect interne)."""
    lowered = url.strip().lower()
    return lowered.startswith("http://") or lowered.startswith("https://")


def normalize_target_url(url: str) -> str:
    """Normalise comme le frontend (normalizeURL) : trim + https:// si aucun schéma.

    Si un schéma est déjà présent (même refusé comme javascript:), on ne
    préfixe pas pour laisser la validation le rejeter.
    """
    import re

    cleaned = (url or "").strip()
    if cleaned and not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", cleaned):
        cleaned = "https://" + cleaned
    return cleaned


def target_host(url: str) -> str:
    """Hôte en minuscules pour la blocklist ('' si illisible)."""
    try:
        from urllib.parse import urlparse

        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


#: Domaines toujours refusés (phishing/malware courants), en plus de QR_BLOCKLIST.
BASE_BLOCKLIST = ("phishing.example", "malware.example")


def is_blocked_target_url(url: str) -> bool:
    """Blocklist : base intégrée + QR_TRACKER_BLOCKLIST (domaine et sous-domaines)."""
    host = target_host(url)
    if not host:
        return True
    if host in ("localhost", "127.0.0.1"):
        return False  # dev local autorisé
    blocklist = [b.lower() for b in getattr(settings, "QR_TRACKER_BLOCKLIST", [])]
    for bad in list(BASE_BLOCKLIST) + blocklist:
        if host == bad or host.endswith("." + bad):
            return True
    return False


def check_create_rate_limit(ip: str, scope: str = "qr_create") -> bool:
    """Rate-limit souple : True si dépassé (QR_TRACKER_CREATE_PER_HOUR / heure / IP / scope)."""
    from django.core.cache import cache

    try:
        limit = int(getattr(settings, "QR_TRACKER_CREATE_PER_HOUR", 30))
    except (TypeError, ValueError):
        limit = 30
    if limit <= 0:
        return False
    key = f"{scope}:{hash_ip(ip)}"
    try:
        count = cache.get(key, 0) + 1
        if count == 1:
            cache.set(key, count, 3600)
        else:
            cache.set(key, count, cache.ttl(key) or 3600)
    except (AttributeError, ValueError):
        # Backend cache sans ttl() (locmem) : fenêtre glissante simplifiée.
        count = cache.get(key, 0) + 1
        cache.set(key, count, 3600)
    return count > limit
