"""Purge RGPD des ScanEvent anciens (défaut : QR_TRACKER_RETENTION_DAYS, 180j)."""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from qr_tracker.models import ScanEvent


class Command(BaseCommand):
    help = "Supprime les ScanEvent plus anciens que la rétention (défaut 180 jours)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--older-than",
            type=int,
            default=None,
            help="Rétention en jours (défaut : QR_TRACKER_RETENTION_DAYS).",
        )

    def handle(self, *args, **options):
        days = options["older_than"]
        if days is None:
            try:
                days = int(getattr(settings, "QR_TRACKER_RETENTION_DAYS", 180))
            except (TypeError, ValueError):
                days = 180
        cutoff = timezone.now() - timedelta(days=days)
        deleted, _ = ScanEvent.objects.filter(scanned_at__lt=cutoff).delete()
        self.stdout.write(self.style.SUCCESS(f"{deleted} ScanEvent supprimés (antérieurs à {cutoff:%Y-%m-%d})."))
