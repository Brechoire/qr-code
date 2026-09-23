"""Tests MVP : création, comptage, anti-refresh, landing, stats."""

from __future__ import annotations

import json
from datetime import timedelta

from django.test import Client, TestCase, override_settings
from django.utils import timezone

from .models import QRLink, ScanEvent


class QRTrackerTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()

    def test_create_url_link(self) -> None:
        resp = self.client.post(
            "/api/links/",
            data=json.dumps({"kind": "url", "target_url": "https://example.com/a"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertIn("short_url", body)
        self.assertTrue(QRLink.objects.filter(short_id=body["short_id"]).exists())

    def test_create_rejects_bad_url(self) -> None:
        resp = self.client.post(
            "/api/links/",
            data=json.dumps({"kind": "url", "target_url": "javascript:alert(1)"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_scan_url_counts_once_then_redirects(self) -> None:
        link = QRLink.objects.create(kind="url", target_url="https://example.com/cible")
        r1 = self.client.get(f"/r/{link.short_id}/", HTTP_USER_AGENT="Mozilla-test")
        self.assertEqual(r1.status_code, 302)
        self.assertEqual(r1["Location"], "https://example.com/cible")
        self.assertEqual(r1["Cache-Control"], "no-store")
        link.refresh_from_db()
        self.assertEqual(link.scan_count, 1)

        # Revisite immédiate même IP : redirigé mais PAS recompté (cooldown).
        r2 = self.client.get(f"/r/{link.short_id}/", HTTP_USER_AGENT="Mozilla-test")
        self.assertEqual(r2.status_code, 302)
        link.refresh_from_db()
        self.assertEqual(link.scan_count, 1)

    def test_scan_wifi_renders_landing_and_counts(self) -> None:
        link = QRLink.objects.create(kind="wifi", payload="WIFI:S:Home;T:WPA;P:secret;;")
        resp = self.client.get(f"/r/{link.short_id}/", HTTP_USER_AGENT="Mozilla-test")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "WIFI:S:Home")
        link.refresh_from_db()
        self.assertEqual(link.scan_count, 1)

    def test_bot_is_not_counted(self) -> None:
        link = QRLink.objects.create(kind="url", target_url="https://example.com/")
        resp = self.client.get(f"/r/{link.short_id}/", HTTP_USER_AGENT="Googlebot/2.1")
        self.assertEqual(resp.status_code, 302)
        link.refresh_from_db()
        self.assertEqual(link.scan_count, 0)

    def test_stats_endpoint(self) -> None:
        link = QRLink.objects.create(kind="text", payload="hello")
        self.client.get(f"/r/{link.short_id}/", HTTP_USER_AGENT="Mozilla-test")
        resp = self.client.get(f"/api/links/{link.short_id}/stats/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["scan_count"], 1)

    def test_home_serves_generator(self) -> None:
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/html", resp["Content-Type"])
        self.assertContains(resp, "app.js")

    def test_frontend_asset_app_js(self) -> None:
        resp = self.client.get("/app.js")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("javascript", resp["Content-Type"])

    # --- Raccourcisseur intégré ---

    def _post_url(self, target: str, ip: str = "127.0.0.1"):
        return self.client.post(
            "/api/links/",
            data=json.dumps({"kind": "url", "target_url": target}),
            content_type="application/json",
            REMOTE_ADDR=ip,
        )

    def test_create_dedupes_same_url(self) -> None:
        r1 = self._post_url("https://example.com/dedupe", ip="10.1.0.1")
        r2 = self._post_url("https://example.com/dedupe", ip="10.1.0.2")
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json()["reused"])
        self.assertEqual(r1.json()["short_id"], r2.json()["short_id"])
        self.assertEqual(QRLink.objects.filter(target_url="https://example.com/dedupe").count(), 1)

    def test_create_normalizes_missing_scheme(self) -> None:
        resp = self._post_url("exemple.com/sans-scheme", ip="10.1.0.3")
        self.assertEqual(resp.status_code, 201)
        link = QRLink.objects.get(short_id=resp.json()["short_id"])
        self.assertEqual(link.target_url, "https://exemple.com/sans-scheme")

    def test_create_rejects_too_long(self) -> None:
        resp = self._post_url("https://example.com/" + "a" * 2000, ip="10.1.0.4")
        self.assertEqual(resp.status_code, 400)

    @override_settings(QR_TRACKER_BLOCKLIST=["evil.test"])
    def test_create_blocked_domain(self) -> None:
        resp = self._post_url("https://evil.test/phish", ip="10.1.0.5")
        self.assertEqual(resp.status_code, 400)

    @override_settings(QR_TRACKER_CREATE_PER_HOUR=1)
    def test_create_rate_limited(self) -> None:
        r1 = self._post_url("https://example.com/rl-1", ip="10.2.0.9")
        r2 = self._post_url("https://example.com/rl-2", ip="10.2.0.9")
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 429)

    def test_purge_scanevents(self) -> None:
        from django.core.management import call_command

        link = QRLink.objects.create(kind="url", target_url="https://example.com/purge")
        old = ScanEvent.objects.create(link=link, ip_hash="x" * 64, user_agent="t")
        ScanEvent.objects.filter(pk=old.pk).update(scanned_at=timezone.now() - timedelta(days=200))
        call_command("purge_scanevents")
        self.assertFalse(ScanEvent.objects.filter(pk=old.pk).exists())

    # --- Page stats dédiée : titre + image + liste/détail ---

    def test_create_stores_title(self) -> None:
        resp = self.client.post(
            "/api/links/",
            data=json.dumps({"kind": "url", "target_url": "https://example.com/titre", "title": "Flyer portes ouvertes"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()["title"], "Flyer portes ouvertes")
        self.assertEqual(QRLink.objects.get(short_id=resp.json()["short_id"]).title, "Flyer portes ouvertes")

    def test_create_rejects_long_title(self) -> None:
        resp = self.client.post(
            "/api/links/",
            data=json.dumps({"kind": "url", "target_url": "https://example.com/t", "title": "x" * 121}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_qr_image_is_png(self) -> None:
        link = QRLink.objects.create(kind="url", target_url="https://example.com/img")
        resp = self.client.get(f"/qr/{link.short_id}/img/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "image/png")
        self.assertTrue(resp.content.startswith(b"\x89PNG"))
        self.assertEqual(self.client.get("/qr/inconnu/img/").status_code, 404)

    def test_qr_image_differs_per_link(self) -> None:
        a = QRLink.objects.create(kind="url", target_url="https://example.com/dec-a")
        b = QRLink.objects.create(kind="url", target_url="https://example.com/dec-b-longer")
        ra = self.client.get(f"/qr/{a.short_id}/img/").content
        rb = self.client.get(f"/qr/{b.short_id}/img/").content
        # Deux short_url différentes -> deux images différentes et non vides.
        self.assertGreater(len(ra), 100)
        self.assertGreater(len(rb), 100)
        self.assertNotEqual(ra, rb)

    def test_dashboard_lists_title_and_qr(self) -> None:
        QRLink.objects.create(kind="url", target_url="https://example.com/d", title="Mon titre")
        resp = self.client.get("/stats/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Mon titre")
        self.assertContains(resp, "/qr/")

    def test_detail_page(self) -> None:
        link = QRLink.objects.create(kind="url", target_url="https://example.com/f")
        resp = self.client.get(f"/stats/{link.short_id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "30 derniers jours")
        self.assertEqual(self.client.get("/stats/inconnu/").status_code, 404)

    # --- Header + stats enrichies : KPI, recherche/tri, récents ---

    def test_dashboard_kpi_and_header(self) -> None:
        QRLink.objects.create(kind="url", target_url="https://example.com/k1", title="Alpha", scan_count=5)
        QRLink.objects.create(kind="url", target_url="https://example.com/k2", title="Beta", scan_count=2)
        resp = self.client.get("/stats/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "aria-current")
        self.assertContains(resp, "Générateur")
        self.assertContains(resp, "Alpha")

    def test_dashboard_search(self) -> None:
        QRLink.objects.create(kind="url", target_url="https://example.com/s1", title="Flyer portes")
        QRLink.objects.create(kind="url", target_url="https://example.com/s2", title="Autre")
        resp = self.client.get("/stats/", {"q": "portes"})
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Flyer portes")
        self.assertNotContains(resp, "<h2>Autre</h2>")
        resp2 = self.client.get("/stats/", {"q": "introuvable-xyz"})
        self.assertContains(resp2, "Aucun résultat")

    def test_dashboard_sort_scans(self) -> None:
        QRLink.objects.create(kind="url", target_url="https://example.com/t1", title="Faible", scan_count=1)
        QRLink.objects.create(kind="url", target_url="https://example.com/t2", title="Fort", scan_count=9)
        resp = self.client.get("/stats/", {"tri": "scans"})
        body = resp.content.decode()
        self.assertLess(body.index("Fort"), body.index("Faible"))
        bad = self.client.get("/stats/", {"tri": "injection"})
        self.assertEqual(bad.status_code, 200)

    def test_detail_recents_and_30d(self) -> None:
        link = QRLink.objects.create(kind="url", target_url="https://example.com/r")
        self.client.get(f"/r/{link.short_id}/", HTTP_USER_AGENT="Mozilla-recent")
        resp = self.client.get(f"/stats/{link.short_id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Derniers scans")
        self.assertContains(resp, "30 derniers jours")
        self.assertContains(resp, "Pic / jour")

    # --- Catégories ---

    def test_create_with_new_category_inline(self) -> None:
        resp = self.client.post(
            "/api/links/",
            data=json.dumps({"kind": "url", "target_url": "https://example.com/cat1", "category": "Flyers"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()["category"], "Flyers")
        link = QRLink.objects.get(short_id=resp.json()["short_id"])
        self.assertEqual(link.category.name, "Flyers")

    def test_category_case_insensitive_dedupe(self) -> None:
        self._post_url("https://example.com/cat2", ip="10.3.0.1")
        r = self.client.post(
            "/api/links/",
            data=json.dumps({"kind": "url", "target_url": "https://example.com/cat3", "category": "SPORT"}),
            content_type="application/json",
            REMOTE_ADDR="10.3.0.2",
        )
        r2 = self.client.post(
            "/api/links/",
            data=json.dumps({"kind": "url", "target_url": "https://example.com/cat4", "category": "sport"}),
            content_type="application/json",
            REMOTE_ADDR="10.3.0.3",
        )
        self.assertEqual(r.json()["category"], "SPORT")
        self.assertEqual(r2.json()["category"], "SPORT")
        from .models import Category

        self.assertEqual(Category.objects.filter(name__iexact="sport").count(), 1)

    def test_create_rejects_long_category(self) -> None:
        resp = self.client.post(
            "/api/links/",
            data=json.dumps({"kind": "url", "target_url": "https://example.com/catlong", "category": "x" * 61}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_reused_link_gets_category(self) -> None:
        self._post_url("https://example.com/cat5", ip="10.3.0.4")
        r2 = self.client.post(
            "/api/links/",
            data=json.dumps({"kind": "url", "target_url": "https://example.com/cat5", "category": "Events"}),
            content_type="application/json",
            REMOTE_ADDR="10.3.0.5",
        )
        self.assertTrue(r2.json()["reused"])
        self.assertEqual(r2.json()["category"], "Events")

    def test_categories_crud(self) -> None:
        c = self.client.post("/api/categories/", data=json.dumps({"name": "Conf"}), content_type="application/json")
        self.assertEqual(c.status_code, 201)
        cid = c.json()["id"]
        dup = self.client.post("/api/categories/", data=json.dumps({"name": "conf"}), content_type="application/json")
        self.assertEqual(dup.status_code, 200)
        self.assertTrue(dup.json()["reused"])
        ren = self.client.put(f"/api/categories/{cid}/", data=json.dumps({"name": "Conferences"}), content_type="application/json")
        self.assertEqual(ren.status_code, 200)
        self.assertEqual(ren.json()["name"], "Conferences")
        lst = self.client.get("/api/categories/")
        self.assertEqual(lst.status_code, 200)
        self.assertTrue(any(x["name"] == "Conferences" for x in lst.json()))

    def test_category_rename_conflict_and_delete_keeps_links(self) -> None:
        a = self.client.post("/api/categories/", data=json.dumps({"name": "AAA"}), content_type="application/json").json()
        b = self.client.post("/api/categories/", data=json.dumps({"name": "BBB"}), content_type="application/json").json()
        clash = self.client.put(f"/api/categories/{b['id']}/", data=json.dumps({"name": "aaa"}), content_type="application/json")
        self.assertEqual(clash.status_code, 400)
        link = QRLink.objects.create(kind="url", target_url="https://example.com/catdel")
        self.client.post(f"/api/links/{link.short_id}/patch/", data=json.dumps({"category": "AAA"}), content_type="application/json")
        d = self.client.delete(f"/api/categories/{a['id']}/")
        self.assertEqual(d.status_code, 200)
        link.refresh_from_db()
        self.assertIsNone(link.category)

    def test_patch_link_category_and_remove(self) -> None:
        link = QRLink.objects.create(kind="url", target_url="https://example.com/catpatch")
        r = self.client.post(f"/api/links/{link.short_id}/patch/", data=json.dumps({"category": "Nouvelle"}), content_type="application/json")
        self.assertEqual(r.json()["category"], "Nouvelle")
        r2 = self.client.post(f"/api/links/{link.short_id}/patch/", data=json.dumps({"category": ""}), content_type="application/json")
        self.assertIsNone(r2.json()["category"])
        self.assertEqual(self.client.post(f"/api/links/inconnu/patch/", data=json.dumps({"category": "X"}), content_type="application/json").status_code, 404)

    def test_dashboard_cat_filter_and_facets(self) -> None:
        QRLink.objects.create(kind="url", target_url="https://example.com/f1", title="Un", scan_count=1)
        from .models import get_or_create_category

        cat = get_or_create_category("Filtre")
        QRLink.objects.create(kind="url", target_url="https://example.com/f2", title="Deux", category=cat)
        resp = self.client.get("/stats/", {"cat": "filtre"})
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Deux")
        self.assertNotContains(resp, "<h2>Un</h2>")
        self.assertContains(resp, "Filtre (1)")
        resp_none = self.client.get("/stats/", {"cat": "aucune"})
        self.assertContains(resp_none, "Un")
        self.assertNotContains(resp_none, "<h2>Deux</h2>")

    def test_categories_page(self) -> None:
        resp = self.client.get("/categories/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Catégories")

    # --- Commit-prep : sécurité, quotas, budgets SQL ---

    def test_create_rejects_long_payload(self) -> None:
        resp = self.client.post(
            "/api/links/",
            data=json.dumps({"kind": "text", "payload": "x" * 4001}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    @override_settings(QR_TRACKER_CREATE_PER_HOUR=2)
    def test_mutation_rate_limits(self) -> None:
        link = QRLink.objects.create(kind="url", target_url="https://example.com/rl-mut")
        ip = "10.9.0.1"

        def patch(goal):
            return self.client.post(
                f"/api/links/{link.short_id}/patch/",
                data=json.dumps({"goal": goal}),
                content_type="application/json",
                REMOTE_ADDR=ip,
            )

        self.assertEqual(patch(1).status_code, 200)
        self.assertEqual(patch(2).status_code, 200)
        self.assertEqual(patch(3).status_code, 429)
        # Autre IP non affectée.
        self.assertEqual(
            self.client.post(
                f"/api/links/{link.short_id}/patch/",
                data=json.dumps({"goal": 4}),
                content_type="application/json",
                REMOTE_ADDR="10.9.0.2",
            ).status_code,
            200,
        )

    def test_dashboard_query_budget(self) -> None:
        for i in range(3):
            QRLink.objects.create(kind="url", target_url=f"https://example.com/b{i}")
        with self.assertNumQueries(10):
            resp = self.client.get("/stats/")
            self.assertEqual(resp.status_code, 200)

    def test_detail_query_budget(self) -> None:
        link = QRLink.objects.create(kind="url", target_url="https://example.com/bdet")
        with self.assertNumQueries(6):
            resp = self.client.get(f"/stats/{link.short_id}/")
            self.assertEqual(resp.status_code, 200)

    def test_recent_sort_puts_never_scanned_last(self) -> None:
        QRLink.objects.create(kind="url", target_url="https://example.com/old")
        new = QRLink.objects.create(kind="url", target_url="https://example.com/new")
        self.client.get(f"/r/{new.short_id}/", HTTP_USER_AGENT="Mozilla-budget")
        resp = self.client.get("/stats/", {"tri": "recent"})
        body = resp.content.decode()
        self.assertLess(body.index(new.short_id), body.index("example.com/old"))

    # --- Stats analytiques : objectif, appareils, notes, courbe, heatmap ---

    def test_patch_goal(self) -> None:
        link = QRLink.objects.create(kind="url", target_url="https://example.com/goal")
        r = self.client.post(f"/api/links/{link.short_id}/patch/", data=json.dumps({"goal": 100}), content_type="application/json")
        self.assertEqual(r.json()["goal"], 100)
        bad = self.client.post(f"/api/links/{link.short_id}/patch/", data=json.dumps({"goal": -5}), content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        bad2 = self.client.post(f"/api/links/{link.short_id}/patch/", data=json.dumps({}), content_type="application/json")
        self.assertEqual(bad2.status_code, 400)

    def test_device_split(self) -> None:
        from .models import ScanEvent

        link = QRLink.objects.create(kind="url", target_url="https://example.com/dev")
        ScanEvent.objects.create(link=link, ip_hash="a" * 64, user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS) Mobile")
        ScanEvent.objects.create(link=link, ip_hash="b" * 64, user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        ScanEvent.objects.create(link=link, ip_hash="c" * 64, user_agent="Mozilla/5.0 (iPad; CPU OS) Tablet")
        resp = self.client.get(f"/stats/{link.short_id}/")
        self.assertContains(resp, "Appareils")
        self.assertContains(resp, "Mobile")
        self.assertEqual(link.scans.count(), 3)

    def test_notes_crud_and_xss_escaped(self) -> None:
        link = QRLink.objects.create(kind="url", target_url="https://example.com/notes")
        r = self.client.post(f"/api/links/{link.short_id}/notes/", data=json.dumps({"text": "flyer <b>distribué</b>"}), content_type="application/json")
        self.assertEqual(r.status_code, 201)
        nid = r.json()["id"]
        page = self.client.get(f"/stats/{link.short_id}/")
        self.assertContains(page, "&lt;b&gt;distribué&lt;/b&gt;")
        self.assertNotContains(page, "<b>distribué</b>")
        bad = self.client.post(f"/api/links/{link.short_id}/notes/", data=json.dumps({"text": "x" * 281}), content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        d = self.client.delete(f"/api/notes/{nid}/")
        self.assertEqual(d.json(), {"deleted": True})

    def test_dashboard_analytics_sections(self) -> None:
        link = QRLink.objects.create(kind="url", target_url="https://example.com/ana", title="Ana")
        self.client.get(f"/r/{link.short_id}/", HTTP_USER_AGENT="Mozilla-ana")
        resp = self.client.get("/stats/")
        self.assertEqual(resp.status_code, 200)
        for needle in ["30 derniers jours", "Rythme hebdomadaire", "Top 5", "Par catégorie", "curve-labels", "globalCurve", "chart.umd.min.js"]:
            self.assertContains(resp, needle)

    def test_dashboard_delta_without_previous(self) -> None:
        resp = self.client.get("/stats/")
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "référence vide")
