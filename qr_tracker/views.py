"""Vues : création de liens, redirection comptée, stats, dashboard."""

from __future__ import annotations

import io
import json
from datetime import timedelta

import segno
from django.conf import settings
from django.db.models import Count, F
from django.db.models.functions import TruncDate
from django.http import FileResponse, HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .models import Category, QRKind, QRLink, ScanEvent, get_or_create_category
from .utils import (
    check_create_rate_limit,
    get_client_ip,
    hash_ip,
    is_allowed_target_url,
    is_blocked_target_url,
    is_bot,
    normalize_target_url,
)


def _short_base_url(request: HttpRequest) -> str:
    configured = getattr(settings, "QR_TRACKER_SHORT_BASE_URL", "").rstrip("/")
    if configured:
        return configured
    return request.build_absolute_uri("/") .rstrip("/")


def _cooldown_seconds() -> int:
    try:
        return int(getattr(settings, "QR_TRACKER_COOLDOWN_SECONDS", 3600))
    except (TypeError, ValueError):
        return 3600


@csrf_exempt
@require_POST
def create_link(request: HttpRequest) -> JsonResponse:
    """POST /api/links/ {kind, target_url|payload} -> {short_id, short_url, reused}.

    Raccourcisseur intégré : même URL normalisée -> même short (dédupe).
    CSRF exempté volontairement pour un usage depuis un fichier local ;
    rate-limit + validation + blocklist avant exposition publique.
    """
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return JsonResponse({"error": "JSON invalide."}, status=400)

    if check_create_rate_limit(get_client_ip(request)):
        return JsonResponse({"error": "Trop de créations, réessayez dans une heure."}, status=429)

    kind = str(data.get("kind", "url")).lower()
    valid_kinds = {c.value for c in QRKind}
    if kind not in valid_kinds:
        return JsonResponse({"error": f"kind inconnu. Attendus : {sorted(valid_kinds)}."}, status=400)

    target_url = str(data.get("target_url", "")).strip()
    payload = str(data.get("payload", "")).strip()
    title = str(data.get("title", "")).strip()
    if len(title) > 120:
        return JsonResponse({"error": "title trop long (max 120 car.)."}, status=400)
    category_raw = " ".join(str(data.get("category", "") or "").strip().split())
    if len(category_raw) > 60:
        return JsonResponse({"error": "category trop longue (max 60 car.)."}, status=400)
    category = get_or_create_category(category_raw) if category_raw else None

    if kind == "url":
        target_url = normalize_target_url(target_url)
        max_len = int(getattr(settings, "QR_TRACKER_MAX_URL_LENGTH", 2000))
        if not target_url or not is_allowed_target_url(target_url):
            return JsonResponse({"error": "target_url http(s) requise pour kind=url."}, status=400)
        if len(target_url) > max_len:
            return JsonResponse({"error": f"target_url trop longue (max {max_len} car.)."}, status=400)
        if is_blocked_target_url(target_url):
            return JsonResponse({"error": "Domaine bloqué."}, status=400)
        # Dédupe : même URL -> même short.
        existing = QRLink.objects.filter(kind=kind, target_url=target_url).first()
        if existing is not None:
            touched = []
            if not existing.title and title:
                existing.title = title
                touched.append("title")
            if existing.category is None and category is not None:
                existing.category = category
                touched.append("category")
            if touched:
                existing.save(update_fields=touched)
            base = _short_base_url(request)
            return JsonResponse(
                {
                    "short_id": existing.short_id,
                    "short_url": f"{base}/r/{existing.short_id}/",
                    "kind": existing.kind,
                    "title": existing.title,
                    "category": existing.category.name if existing.category else None,
                    "scan_count": existing.scan_count,
                    "reused": True,
                },
                status=200,
            )
    elif not payload:
        return JsonResponse({"error": f"payload requis pour kind={kind}."}, status=400)
    if payload and len(payload) > int(getattr(settings, "QR_TRACKER_MAX_PAYLOAD_LENGTH", 4000)):
        return JsonResponse({"error": "payload trop long (max 4000 car.)."}, status=400)

    from django.db import IntegrityError

    from .models import generate_short_id

    link = None
    created = True
    for _ in range(5):  # retry collision short_id / race dédupe
        try:
            if kind == "url":
                link, created = QRLink.objects.get_or_create(
                    kind=kind,
                    target_url=target_url,
                    defaults={
                        "short_id": generate_short_id(),
                        "payload": payload,
                        "title": title,
                        "category": category,
                    },
                )
                if not created:
                    touched = []
                    if not link.title and title:
                        link.title = title
                        touched.append("title")
                    if link.category is None and category is not None:
                        link.category = category
                        touched.append("category")
                    if touched:
                        link.save(update_fields=touched)
            else:
                link = QRLink.objects.create(
                    kind=kind, target_url=target_url, payload=payload, title=title, category=category
                )
                created = True
            break
        except IntegrityError:
            # Collision short_id : on réessaie avec un nouvel id.
            # Race dédupe : la contrainte uniq_url_target lève aussi -> on relit.
            existing = QRLink.objects.filter(kind=kind, target_url=target_url).first() if kind == "url" else None
            if existing is not None:
                link, created = existing, False
                break
            continue
    if link is None:
        return JsonResponse({"error": "Création impossible, réessayez."}, status=500)
    base = _short_base_url(request)
    return JsonResponse(
        {
            "short_id": link.short_id,
            "short_url": f"{base}/r/{link.short_id}/",
            "kind": link.kind,
            "title": link.title,
            "category": link.category.name if link.category else None,
            "scan_count": link.scan_count,
            "reused": not created,
        },
        status=200 if not created else 201,
    )


@require_GET
def resolve_link(request: HttpRequest, short_id: str) -> HttpResponse:
    """GET /r/<short_id>/ : compte le scan puis redirige ou affiche.

    - kind=url → 302 vers target_url (jamais 301 pour éviter le cache).
    - autres kinds → landing page avec le contenu lisible.
    - bots et revisites dans le cooldown : affichés/redirigés SANS +1.
    """
    link = get_object_or_404(QRLink, short_id=short_id)
    ua = request.META.get("HTTP_USER_AGENT", "")[:500]
    counted = False

    if not is_bot(ua):
        ip_hash = hash_ip(get_client_ip(request))
        cutoff = timezone.now() - timedelta(seconds=_cooldown_seconds())
        recent = ScanEvent.objects.filter(link=link, ip_hash=ip_hash, scanned_at__gte=cutoff).exists()
        if not recent:
            from django.db.models import F

            ScanEvent.objects.create(link=link, ip_hash=ip_hash, user_agent=ua)
            QRLink.objects.filter(pk=link.pk).update(
                scan_count=F("scan_count") + 1, last_scanned_at=timezone.now()
            )
            link.refresh_from_db(fields=["scan_count", "last_scanned_at"])
            counted = True

    response: HttpResponse
    if link.kind == QRKind.URL and link.target_url:
        from django.shortcuts import redirect

        response = redirect(link.target_url)  # 302 par défaut
    else:
        response = render(request, "qr_tracker/landing.html", {"link": link, "counted": counted})
    response["Cache-Control"] = "no-store"
    return response


@require_GET
def link_stats(request: HttpRequest, short_id: str) -> JsonResponse:
    """GET /api/links/<short_id>/stats/ : compteur + historique par jour."""
    link = get_object_or_404(QRLink.objects.select_related("category"), short_id=short_id)
    per_day = (
        ScanEvent.objects.filter(link=link)
        .annotate(day=TruncDate("scanned_at"))
        .values("day")
        .annotate(count=Count("id"))
        .order_by("day")
    )
    return JsonResponse(
        {
            "short_id": link.short_id,
            "kind": link.kind,
            "title": link.title,
            "category": link.category.name if link.category else None,
            "scan_count": link.scan_count,
            "last_scanned_at": link.last_scanned_at.isoformat() if link.last_scanned_at else None,
            "created_at": link.created_at.isoformat(),
            "per_day": [{"day": str(r["day"]), "count": r["count"]} for r in per_day],
        }
    )


def _category_payload(cat) -> dict:
    return {
        "id": cat.id,
        "name": cat.name,
        "links_count": cat.links.count(),
        "created_at": cat.created_at.isoformat(),
    }


@csrf_exempt
def categories(request: HttpRequest) -> JsonResponse:
    """GET /api/categories/ : liste + compteurs. POST : création inline."""

    if request.method == "GET":
        from django.db.models import Count as _Count

        cats = Category.objects.annotate(_n=_Count("links")).all()
        return JsonResponse(
            [
                {
                    "id": c.id,
                    "name": c.name,
                    "links_count": c._n,
                    "created_at": c.created_at.isoformat(),
                }
                for c in cats
            ],
            safe=False,
        )
    if request.method == "POST":
        if check_create_rate_limit(get_client_ip(request)):
            return JsonResponse({"error": "Trop de créations, réessayez dans une heure."}, status=429)
        try:
            data = json.loads(request.body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            return JsonResponse({"error": "JSON invalide."}, status=400)
        raw = " ".join(str(data.get("name", "") or "").strip().split())
        if not raw:
            return JsonResponse({"error": "name requis."}, status=400)
        if len(raw) > 60:
            return JsonResponse({"error": "name trop long (max 60 car.)."}, status=400)
        existing = Category.objects.filter(name__iexact=raw).first()
        if existing is not None:
            body = _category_payload(existing)
            body["reused"] = True
            return JsonResponse(body, status=200)
        cat = Category.objects.create(name=raw)
        body = _category_payload(cat)
        body["reused"] = False
        return JsonResponse(body, status=201)
    return JsonResponse({"error": "Méthode non supportée."}, status=405)


@csrf_exempt
def category_detail(request: HttpRequest, category_id: int) -> JsonResponse:
    """PUT /api/categories/<id>/ : renommer. DELETE : supprimer (liens -> NULL)."""
    cat = get_object_or_404(Category, pk=category_id)
    if request.method in ("PUT", "DELETE") and check_create_rate_limit(get_client_ip(request), "qr_category_write"):
        return JsonResponse({"error": "Trop de modifications, réessayez dans une heure."}, status=429)
    if request.method == "PUT":
        try:
            data = json.loads(request.body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            return JsonResponse({"error": "JSON invalide."}, status=400)
        raw = " ".join(str(data.get("name", "") or "").strip().split())
        if not raw:
            return JsonResponse({"error": "name requis."}, status=400)
        if len(raw) > 60:
            return JsonResponse({"error": "name trop long (max 60 car.)."}, status=400)
        clash = Category.objects.filter(name__iexact=raw).exclude(pk=cat.pk).first()
        if clash is not None:
            return JsonResponse({"error": f"« {clash.name} » existe déjà."}, status=400)
        cat.name = raw
        cat.save(update_fields=["name"])
        return JsonResponse(_category_payload(cat))
    if request.method == "DELETE":
        count = cat.links.count()
        cat.delete()  # SET_NULL : les QR sont conservés sans catégorie.
        return JsonResponse({"deleted": True, "links_untagged": count})
    return JsonResponse({"error": "Méthode non supportée."}, status=405)


@csrf_exempt
@require_POST
def patch_link(request: HttpRequest, short_id: str) -> JsonResponse:
    """POST /api/links/<short_id>/patch/ {category?, goal?} : réassigner catégorie ('' = retirer) et/ou objectif (≥ 0)."""
    link = get_object_or_404(QRLink, short_id=short_id)
    if check_create_rate_limit(get_client_ip(request), "qr_patch"):
        return JsonResponse({"error": "Trop de modifications, réessayez dans une heure."}, status=429)
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return JsonResponse({"error": "JSON invalide."}, status=400)
    if "category" not in data and "goal" not in data:
        return JsonResponse({"error": "category ou goal requis."}, status=400)
    touched = []
    if "category" in data:
        raw = " ".join(str(data.get("category") or "").strip().split())
        if len(raw) > 60:
            return JsonResponse({"error": "category trop longue (max 60 car.)."}, status=400)
        link.category = get_or_create_category(raw) if raw else None
        touched.append("category")
    if "goal" in data:
        try:
            goal = int(data.get("goal"))
        except (TypeError, ValueError):
            return JsonResponse({"error": "goal doit être un entier ≥ 0."}, status=400)
        if goal < 0 or goal > 1000000:
            return JsonResponse({"error": "goal doit être entre 0 et 1000000."}, status=400)
        link.goal = goal
        touched.append("goal")
    link.save(update_fields=touched)
    return JsonResponse(
        {
            "short_id": link.short_id,
            "category": link.category.name if link.category else None,
            "goal": link.goal,
        }
    )


@csrf_exempt
def link_notes(request: HttpRequest, short_id: str) -> JsonResponse:
    """GET /api/links/<short_id>/notes/ : liste. POST {text} : ajout (280 max)."""
    from .models import QRNote

    link = get_object_or_404(QRLink, short_id=short_id)
    if request.method == "GET":
        return JsonResponse(
            [
                {"id": n.id, "text": n.text, "created_at": n.created_at.isoformat()}
                for n in link.notes.all()
            ],
            safe=False,
        )
    if request.method == "POST":
        if check_create_rate_limit(get_client_ip(request), "qr_notes"):
            return JsonResponse({"error": "Trop de créations, réessayez dans une heure."}, status=429)
        try:
            data = json.loads(request.body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            return JsonResponse({"error": "JSON invalide."}, status=400)
        text = " ".join(str(data.get("text", "") or "").strip().split())
        if not text:
            return JsonResponse({"error": "text requis."}, status=400)
        if len(text) > 280:
            return JsonResponse({"error": "text trop long (max 280 car.)."}, status=400)
        note = QRNote.objects.create(link=link, text=text)
        return JsonResponse(
            {"id": note.id, "text": note.text, "created_at": note.created_at.isoformat()},
            status=201,
        )
    return JsonResponse({"error": "Méthode non supportée."}, status=405)


@csrf_exempt
def note_detail(request: HttpRequest, note_id: int) -> JsonResponse:
    """DELETE /api/notes/<id>/ : suppression."""
    from .models import QRNote

    note = get_object_or_404(QRNote, pk=note_id)
    if request.method == "DELETE":
        if check_create_rate_limit(get_client_ip(request), "qr_notes"):
            return JsonResponse({"error": "Trop de suppressions, réessayez dans une heure."}, status=429)
        note.delete()
        return JsonResponse({"deleted": True})
    return JsonResponse({"error": "Méthode non supportée."}, status=405)


@require_GET
def categories_page(request: HttpRequest) -> HttpResponse:
    """GET /categories/ : gestion (liste, renommer, supprimer, créer)."""
    from django.db.models import Count


    cats = list(Category.objects.annotate(n=Count("links")).order_by("name"))
    return render(request, "qr_tracker/categories.html", {"categories": cats})


@require_GET
def qr_image(request: HttpRequest, short_id: str) -> HttpResponse:
    """GET /qr/<short_id>/img/ : PNG du QR encodant la short_url (cible immuable -> cache long)."""
    link = get_object_or_404(QRLink, short_id=short_id)
    base = _short_base_url(request)
    short_url = f"{base}/r/{link.short_id}/"
    buf = io.BytesIO()
    segno.make(short_url, error="m").save(buf, kind="png", scale=8, border=2)
    response = HttpResponse(buf.getvalue(), content_type="image/png")
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    response["Content-Disposition"] = f'inline; filename="qr-{link.short_id}.png"'
    return response


def _device_split(link: QRLink) -> dict:
    """Répartition mobile / tablette / desktop / autre (estimation via user-agent)."""
    from .models import ScanEvent as _ScanEvent

    families = {"mobile": 0, "tablette": 0, "desktop": 0, "autre": 0}
    for row in _ScanEvent.objects.filter(link=link).values("user_agent").annotate(n=Count("id")):
        ua = (row["user_agent"] or "").lower()
        if "tablet" in ua or "ipad" in ua:
            families["tablette"] += row["n"]
        elif "mobi" in ua or "android" in ua or "iphone" in ua:
            families["mobile"] += row["n"]
        elif not ua:
            families["autre"] += row["n"]
        else:
            families["desktop"] += row["n"]
    return families


def _global_curve(days: int = 30) -> tuple[list, list, int, int]:
    """Courbe globale (labels ISO, comptes) + totaux période en cours / précédente."""
    today = timezone.localdate()
    start = today - timedelta(days=days - 1)
    prev_start = start - timedelta(days=days)
    counts: dict[str, int] = {}
    for row in (
        ScanEvent.objects.filter(scanned_at__date__gte=prev_start)
        .annotate(day=TruncDate("scanned_at"))
        .values("day")
        .annotate(count=Count("id"))
    ):
        counts[str(row["day"])] = row["count"]
    labels, values = [], []
    for i in range(days - 1, -1, -1):
        key = str(today - timedelta(days=i))
        labels.append(key)
        values.append(counts.get(key, 0))
    current_total = sum(values)
    prev_total = sum(v for k, v in counts.items() if k < str(start))
    return labels, values, current_total, prev_total


def _heatmap() -> tuple[list, int]:
    """Matrice 7 (lun–dim) × 24 h des scans sur 90 jours + max pour l'échelle."""
    from django.db.models.functions import ExtractHour, ExtractWeekDay

    since = timezone.now() - timedelta(days=90)
    grid = [[0] * 24 for _ in range(7)]
    for row in (
        ScanEvent.objects.filter(scanned_at__gte=since)
        .annotate(wd=ExtractWeekDay("scanned_at"), h=ExtractHour("scanned_at"))
        .values("wd", "h")
        .annotate(count=Count("id"))
    ):
        # ExtractWeekDay : 1 = dimanche … 7 = samedi -> index 0 = lundi.
        grid[(row["wd"] + 5) % 7][row["h"]] = row["count"]
    peak = max((v for line in grid for v in line), default=0)
    return grid, peak or 1


@require_GET
def link_detail(request: HttpRequest, short_id: str) -> HttpResponse:
    """GET /stats/<short_id>/ : fiche (titre, liens, QR, total, pic, moyenne, 30 j, récents, appareils, notes)."""
    link = get_object_or_404(QRLink.objects.select_related("category"), short_id=short_id)
    month_ago = timezone.now() - timedelta(days=30)
    per_day = list(
        ScanEvent.objects.filter(link=link, scanned_at__gte=month_ago)
        .annotate(day=TruncDate("scanned_at"))
        .values("day")
        .annotate(count=Count("id"))
        .order_by("day")
    )
    peak = max([r["count"] for r in per_day], default=0)
    moyenne = round(link.scan_count / len(per_day), 1) if per_day else 0
    recents = list(link.scans.order_by("-scanned_at")[:10])
    scans_7j = link.scans.filter(scanned_at__gte=timezone.now() - timedelta(days=7)).count()
    devices = _device_split(link)
    notes = list(link.notes.all()[:50])
    goal_pct = min(100, round(link.scan_count / link.goal * 100)) if link.goal else None
    month_labels = [str(r["day"]) for r in per_day]
    month_values = [r["count"] for r in per_day]
    return render(
        request,
        "qr_tracker/detail.html",
        {
            "link": link, "per_day": per_day, "peak": peak or 1, "moyenne": moyenne,
            "recents": recents, "scans_7j": scans_7j, "devices": devices,
            "notes": notes, "goal_pct": goal_pct,
            "month_labels": month_labels, "month_values": month_values,
        },
    )


DASHBOARD_TRI = {
    # NULL explicites : jamais-scannés en dernier sur tous les backends.
    "recent": F("last_scanned_at").desc(nulls_last=True),
    "scans": "-scan_count",
    "titre": "title",
    "cree": "-created_at",
}


@require_GET
def dashboard(request: HttpRequest) -> HttpResponse:
    """GET /stats/ : synthèse KPI + recherche/tri + cartes titre + lien + QR + scans."""
    from django.db.models import Q, Sum

    q = str(request.GET.get("q", "")).strip()[:120]
    tri = str(request.GET.get("tri", "recent"))
    if tri not in DASHBOARD_TRI:
        tri = "recent"
    cat = str(request.GET.get("cat", "")).strip()[:60]
    week_ago = timezone.now() - timedelta(days=7)
    qs = QRLink.objects.select_related("category").all()
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(target_url__icontains=q))
    if cat == "aucune":
        qs = qs.filter(category__isnull=True)
    elif cat:
        qs = qs.filter(category__name__iexact=cat)
    links = list(
        qs.annotate(scans_7j=Count("scans", filter=Q(scans__scanned_at__gte=week_ago)))
        .order_by(DASHBOARD_TRI[tri], "-created_at")[:200]
    )
    # Sparkline 14 jours par carte (1 seule requête).
    fortnight_ago = timezone.now() - timedelta(days=14)
    per_link_day = {}
    if links:
        for row in (
            ScanEvent.objects.filter(link__in=[l.pk for l in links], scanned_at__gte=fortnight_ago)
            .annotate(day=TruncDate("scanned_at"))
            .values("link_id", "day")
            .annotate(count=Count("id"))
        ):
            per_link_day[(row["link_id"], str(row["day"]))] = row["count"]
    today = timezone.localdate()
    day_keys = [str(today - timedelta(days=i)) for i in range(13, -1, -1)]
    for link in links:
        spark = [per_link_day.get((link.pk, d), 0) for d in day_keys]
        link.spark = spark
        link.spark_max = max(spark) or 1
        link.spark_days = day_keys
    agg = QRLink.objects.aggregate(total_qr=Count("id"), total_scans=Sum("scan_count"))
    top = QRLink.objects.order_by("-scan_count", "-created_at").first()
    scans_7j = ScanEvent.objects.filter(scanned_at__gte=week_ago).count()
    facets = list(
        Category.objects.annotate(n=Count("links")).order_by("name").values("name", "n")
    )
    curve_labels, curve_values, curve_total, curve_prev = _global_curve()
    if curve_prev:
        curve_delta = round((curve_total - curve_prev) / curve_prev * 100)
    else:
        curve_delta = None
    curve_rows = list(zip(curve_labels, curve_values))
    heatmap, heat_peak = _heatmap()
    total_scans = agg["total_scans"] or 0
    top5 = []
    for row in QRLink.objects.order_by("-scan_count", "-created_at").values(
        "short_id", "title", "target_url", "scan_count"
    )[:5]:
        share = round(row["scan_count"] / total_scans * 100) if total_scans else 0
        top5.append({**row, "share": share})
    cat_stats = list(
        Category.objects.annotate(n=Count("links"), scans=Sum("links__scan_count")).order_by("-scans", "name").values("name", "n", "scans")
    )
    for row in cat_stats:
        row["scans"] = row["scans"] or 0
    cat_peak = max([r["scans"] for r in cat_stats], default=0) or 1
    return render(
        request,
        "qr_tracker/dashboard.html",
        {
            "links": links,
            "q": q,
            "tri": tri,
            "cat": cat,
            "facets": facets,
            "total_qr": agg["total_qr"] or 0,
            "total_scans": total_scans,
            "top": top,
            "scans_7j": scans_7j,
            "curve_labels": curve_labels,
            "curve_values": curve_values,
            "curve_rows": curve_rows,
            "curve_total": curve_total,
            "curve_prev": curve_prev,
            "curve_delta": curve_delta,
            "heatmap": heatmap,
            "heat_peak": heat_peak,
            "top5": top5,
            "cat_stats": cat_stats,
            "cat_peak": cat_peak,
        },
    )


# --- Page d'accueil : générateur existant (index.html + app.js) ---

_FRONTEND_ASSETS = {
    "app.js": "text/javascript",
    "script.js": "text/javascript",
    "style.css": "text/css",
}


@require_GET
def home(request: HttpRequest) -> FileResponse:
    """GET / : sert le générateur existant (index.html à la racine)."""
    return FileResponse(open(settings.BASE_DIR / "index.html", "rb"), content_type="text/html")


@require_GET
def frontend_asset(request: HttpRequest, filename: str) -> FileResponse:
    """Sert les assets du générateur (app.js, style.css, script.js) sans déplacer les fichiers."""
    content_type = _FRONTEND_ASSETS.get(filename)
    if content_type is None:
        from django.http import Http404

        raise Http404()
    return FileResponse(open(settings.BASE_DIR / filename, "rb"), content_type=content_type)
