from django.core.management.base import BaseCommand

from apps.tenancy.seed import seed_organization


class Command(BaseCommand):
    help = "Create the default organization and its settings/branch/location/register (idempotent)."

    def handle(self, *args, **options):
        org = seed_organization()
        self.stdout.write(f"Organization ready: {org.slug}")
