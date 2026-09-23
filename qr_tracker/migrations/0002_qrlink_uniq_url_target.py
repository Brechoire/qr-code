# Dédupe les QRLink url existants puis contrainte d'unicité (raccourcisseur : même URL -> même short).

from django.db import migrations, models
from django.db.models import Count, Max, Sum


def dedupe_url_links(apps, schema_editor):
    QRLink = apps.get_model("qr_tracker", "QRLink")
    ScanEvent = apps.get_model("qr_tracker", "ScanEvent")
    dupes = (
        QRLink.objects.filter(kind="url")
        .values("target_url")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
    )
    for row in dupes:
        links = list(QRLink.objects.filter(kind="url", target_url=row["target_url"]).order_by("id"))
        keep, others = links[0], links[1:]
        other_ids = [o.id for o in others]
        ScanEvent.objects.filter(link_id__in=other_ids).update(link_id=keep.id)
        agg = QRLink.objects.filter(id__in=other_ids).aggregate(total=Sum("scan_count"), last=Max("last_scanned_at"))
        keep.scan_count = (keep.scan_count or 0) + (agg["total"] or 0)
        if agg["last"] and (keep.last_scanned_at is None or agg["last"] > keep.last_scanned_at):
            keep.last_scanned_at = agg["last"]
        keep.save(update_fields=["scan_count", "last_scanned_at"])
        QRLink.objects.filter(id__in=other_ids).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('qr_tracker', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(dedupe_url_links, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='qrlink',
            constraint=models.UniqueConstraint(condition=models.Q(('kind', 'url')), fields=('kind', 'target_url'), name='uniq_url_target'),
        ),
    ]
