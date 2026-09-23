from django.contrib import admin

from .models import Category, QRLink, QRNote, ScanEvent


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "links_count", "created_at")
    search_fields = ("name",)

    @admin.display(description="QR liés")
    def links_count(self, obj):
        return obj.links.count()


@admin.register(QRLink)
class QRLinkAdmin(admin.ModelAdmin):
    list_display = ("short_id", "title", "category", "kind", "scan_count", "goal", "last_scanned_at", "created_at")
    list_filter = ("kind", "category")
    search_fields = ("short_id", "title", "target_url")
    readonly_fields = ("scan_count", "last_scanned_at", "created_at")
    autocomplete_fields = ("category",)
    list_select_related = ("category",)


@admin.register(QRNote)
class QRNoteAdmin(admin.ModelAdmin):
    list_display = ("link", "text", "created_at")
    search_fields = ("text", "link__short_id")
    list_select_related = ("link",)


@admin.register(ScanEvent)
class ScanEventAdmin(admin.ModelAdmin):
    list_display = ("link", "scanned_at")
    list_filter = ("scanned_at",)
    search_fields = ("link__short_id",)
    readonly_fields = ("link", "scanned_at", "ip_hash", "user_agent")
    list_select_related = ("link",)

    def has_add_permission(self, request):
        return False
