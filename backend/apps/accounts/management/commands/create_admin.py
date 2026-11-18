"""First Admin of a new café (production setup). The password is never a command-line argument
(it would stay in the shell history and in `ps`): it is typed twice at a hidden prompt, or read
from the first line of stdin with --password-stdin (for scripts)."""

import getpass
import sys

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.audit.services import record
from apps.tenancy.models import Organization


class Command(BaseCommand):
    help = (
        "Create the first Admin of a café. Does nothing (exit 0) when the café already has an "
        "active Admin, unless --force. Run `seed_org` first."
    )

    def add_arguments(self, parser):
        parser.add_argument("--org", help="Café slug (default: the only café).")
        parser.add_argument("--username", help="Asked for when missing.")
        parser.add_argument("--display-name", default="")
        parser.add_argument(
            "--password-stdin", action="store_true", help="Read the password from stdin."
        )
        parser.add_argument(
            "--force", action="store_true", help="Create another Admin even if one exists."
        )

    def _org(self, slug):
        orgs = Organization.objects.filter(slug=slug) if slug else Organization.objects.all()
        if orgs.count() != 1:
            raise CommandError(
                "Café not found: run `seed_org` first."
                if not orgs.exists()
                else "More than one café: pass --org <slug>."
            )
        return orgs.get()

    def _password(self, options, user):
        if options["password_stdin"]:
            password = sys.stdin.readline().rstrip("\r\n")
        else:
            if not sys.stdin.isatty():
                raise CommandError("No terminal for the password prompt: use --password-stdin.")
            password = getpass.getpass("Password: ")
            if getpass.getpass("Password (again): ") != password:
                raise CommandError("The two passwords differ.")
        try:
            validate_password(password, user)
        except ValidationError as e:
            raise CommandError("Password refused: " + " ".join(e.messages)) from None
        return password

    def handle(self, *args, **options):
        org = self._org(options["org"])
        if (
            not options["force"]
            and User.objects.filter(organization=org, role=User.Role.ADMIN, is_active=True).exists()
        ):
            self.stderr.write(
                "This café already has an active Admin: nothing was created. "
                "Use --force to add another one."
            )
            return
        username = (options["username"] or input("Username: ")).strip()
        if not username or len(username) > 150:
            raise CommandError("The username is required (up to 150 characters).")
        if User.objects.filter(username__iexact=username).exists():
            raise CommandError(f"The username '{username}' is already taken.")
        user = User(username=username, organization=org, role=User.Role.ADMIN)
        user.display_name = options["display_name"].strip() or username
        user.set_password(self._password(options, user))
        with transaction.atomic():
            user.save()
            record(
                None,
                "user.created",
                user,
                {"username": username, "role": "admin", "via": "create_admin"},
                organization=org,
            )
        self.stdout.write(f"Admin '{username}' created for {org.name}.")
