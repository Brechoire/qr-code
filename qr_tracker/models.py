"""Modèles de suivi des scans de QR dynamiques.

QRLink : un QR dynamique compté. Le QR imprimé encode la short URL
(``/r/<short_id>/``) au lieu du contenu final.
ScanEvent : une ligne horodatée par visite comptabilisée (IP hashée, RGPD).
"""

from __future__ import annotations

import secrets

from django.db import models


class QRKind(models.TextChoices):
    URL = "url", "URL"
    TEXT = "text", "Texte"
    WIFI = "wifi", "WiFi"
    EMAIL = "email", "Email"
    PHONE = "phone", "Téléphone"
    VCARD = "vcard", "vCard"


def generate_short_id(nbytes: int = 4) -> str:
    """Génère un identifiant court URL-safe (défaut ~6-7 caractères)."""
    return secrets.token_urlsafe(nbytes).rstrip("=").replace("-", "").replace("_", "")[:8] or secrets.token_hex(4)[:8]


def normalize_category_name(name: str) -> str:
    """Normalise un nom de catégorie (comparaison insensible à la casse)."""
    return " ".join(str(name or "").strip().split()).lower()


def get_or_create_category(name: str) -> Category | None:
    """Récupère ou crée une catégorie (insensible à la casse, 1re casse conservée)."""
    from django.db import IntegrityError

    cleaned = " ".join(str(name or "").strip().split())
    if not cleaned:
        return None
    existing = Category.objects.filter(name__iexact=cleaned).first()
    if existing is not None:
        return existing
    try:
        return Category.objects.create(name=cleaned[:60])
    except IntegrityError:
        return Category.objects.filter(name__iexact=cleaned).first()


class Category(models.Model):
    name = models.CharField(max_length=60, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "categories"

    def __str__(self) -> str:
        return str(self.name)


class QRLink(models.Model):
    short_id = models.CharField(max_length=16, unique=True, default=generate_short_id, db_index=True)
    kind = models.CharField(max_length=10, choices=QRKind.choices, default=QRKind.URL)
    title = models.CharField(max_length=120, blank=True, default="")
    category = models.ForeignKey(
        Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="links", db_index=True
    )
    # Pour kind=url : URL finale. Pour les autres : payload brut (WIFI:..., BEGIN:VCARD...).
    target_url = models.URLField(max_length=2000, blank=True)
    payload = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    scan_count = models.PositiveIntegerField(default=0)
    last_scanned_at = models.DateTimeField(null=True, blank=True)
    goal = models.PositiveIntegerField(default=0, help_text="Objectif de scans (0 = aucun).")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # Dédupe raccourcisseur : même URL normalisée -> même short (réutilisé).
            models.UniqueConstraint(
                fields=["kind", "target_url"],
                condition=models.Q(kind="url"),
                name="uniq_url_target",
            ),
        ]
        indexes = [
            models.Index(fields=["-last_scanned_at"], name="qrlink_recent_idx"),
            models.Index(fields=["-scan_count"], name="qrlink_scans_idx"),
            models.Index(fields=["-created_at"], name="qrlink_created_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.short_id} ({self.kind}) — {self.scan_count} scans"

    def display_content(self) -> str:
        """Contenu à afficher sur la landing page (non-URL) ou cible."""
        if self.kind == QRKind.URL:
            return str(self.target_url)
        return str(self.payload)

    def display_title(self) -> str:
        """Titre saisi ou, à défaut, domaine + date de création."""
        if str(self.title).strip():
            return str(self.title).strip()
        from urllib.parse import urlparse

        host = urlparse(str(self.target_url) or str(self.payload)).hostname or str(self.short_id)
        return f"{host} — {self.created_at:%d/%m/%Y}" if self.created_at else str(host)


class ScanEvent(models.Model):
    link = models.ForeignKey(QRLink, on_delete=models.CASCADE, related_name="scans")
    scanned_at = models.DateTimeField(auto_now_add=True, db_index=True)
    ip_hash = models.CharField(max_length=64, db_index=True)
    user_agent = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-scanned_at"]
        indexes = [
            models.Index(fields=["link", "-scanned_at"]),
            # Cooldown anti-recomptage : filtre (link, ip_hash, scanned_at >=).
            models.Index(fields=["link", "ip_hash", "scanned_at"], name="scan_cooldown_idx"),
        ]

    def __str__(self) -> str:
        return f"scan {self.link.short_id} @ {self.scanned_at:%Y-%m-%d %H:%M}"

    def device_family(self) -> str:
        """Classification grossière du user-agent : mobile / tablette / desktop / autre."""
        ua = (self.user_agent or "").lower()
        if "tablet" in ua or "ipad" in ua:
            return "tablette"
        if "mobi" in ua or "android" in ua or "iphone" in ua:
            return "mobile"
        if not ua:
            return "autre"
        return "desktop"


class QRNote(models.Model):
    link = models.ForeignKey(QRLink, on_delete=models.CASCADE, related_name="notes")
    text = models.CharField(max_length=280)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["link", "-created_at"], name="note_link_created_idx"),
        ]

    def __str__(self) -> str:
        return f"note {self.link.short_id} @ {self.created_at:%Y-%m-%d %H:%M}"
