from django.urls import path

from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("app.js", views.frontend_asset, {"filename": "app.js"}, name="frontend-app-js"),
    path("style.css", views.frontend_asset, {"filename": "style.css"}, name="frontend-style"),
    path("script.js", views.frontend_asset, {"filename": "script.js"}, name="frontend-script"),
    path("api/links/", views.create_link, name="qr-create-link"),
    path("api/links/<str:short_id>/stats/", views.link_stats, name="qr-link-stats"),
    path("api/links/<str:short_id>/patch/", views.patch_link, name="qr-patch-link"),
    path("api/links/<str:short_id>/notes/", views.link_notes, name="qr-link-notes"),
    path("api/notes/<int:note_id>/", views.note_detail, name="qr-note-detail"),
    path("api/categories/", views.categories, name="qr-categories"),
    path("api/categories/<int:category_id>/", views.category_detail, name="qr-category-detail"),
    path("categories/", views.categories_page, name="qr-categories-page"),
    path("r/<str:short_id>/", views.resolve_link, name="qr-resolve"),
    path("qr/<str:short_id>/img/", views.qr_image, name="qr-image"),
    path("stats/<str:short_id>/", views.link_detail, name="qr-detail"),
    path("stats/", views.dashboard, name="qr-dashboard"),
]
