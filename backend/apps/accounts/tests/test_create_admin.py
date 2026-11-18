import io

import pytest
from django.core.management import CommandError, call_command

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.tenancy.models import Organization
from apps.tenancy.seed import seed_organization

pytestmark = pytest.mark.django_db
GOOD = "Caf3-Opening-Day-77"


def run(monkeypatch, *args, password=GOOD):
    monkeypatch.setattr("sys.stdin", io.StringIO(f"{password}\n"))
    out, err = io.StringIO(), io.StringIO()
    call_command("create_admin", *args, "--password-stdin", stdout=out, stderr=err)
    return out.getvalue(), err.getvalue()


def test_creates_the_first_admin_and_records_who_without_the_password(monkeypatch, org):
    out, _ = run(monkeypatch, "--username", "owner", "--display-name", "The Owner")
    u = User.objects.get(username="owner")
    assert u.role == "admin" and u.organization == org and u.display_name == "The Owner"
    assert u.check_password(GOOD) and "owner" in out
    e = AuditEvent.objects.get(action="user.created")
    assert e.actor is None and e.organization == org and e.entity_id == u.pk
    assert e.summary == {"username": "owner", "role": "admin", "via": "create_admin"}
    assert GOOD not in str(AuditEvent.objects.values_list("summary", flat=True))


def test_it_refuses_a_weak_password_and_creates_nothing(monkeypatch, org):
    for weak in ("short", "password1234", "12345678901234"):
        with pytest.raises(CommandError, match="Password refused"):
            run(monkeypatch, "--username", "owner", password=weak)
    assert not User.objects.exists()


def test_a_second_run_does_nothing_and_still_succeeds(monkeypatch, org):
    run(monkeypatch, "--username", "owner")
    _, err = run(monkeypatch, "--username", "someone-else")
    assert "already has an active Admin" in err
    assert list(User.objects.values_list("username", flat=True)) == ["owner"]


def test_force_adds_another_admin(monkeypatch, org):
    run(monkeypatch, "--username", "owner")
    run(monkeypatch, "--username", "second", "--force")
    assert User.objects.filter(role="admin").count() == 2


def test_an_inactive_admin_does_not_count(monkeypatch, org):
    run(monkeypatch, "--username", "owner")
    User.objects.update(is_active=False)
    run(monkeypatch, "--username", "owner2")
    assert User.objects.filter(is_active=True, role="admin").count() == 1


def test_username_is_unique_ignoring_case(monkeypatch, org):
    run(monkeypatch, "--username", "Owner")
    with pytest.raises(CommandError, match="already taken"):
        run(monkeypatch, "--username", "OWNER", "--force")


def test_needs_the_cafe_to_exist_and_a_choice_when_there_are_two(monkeypatch, db):
    with pytest.raises(CommandError, match="seed_org"):
        run(monkeypatch, "--username", "owner")
    seed_organization("A", "a")
    seed_organization("B", "b")
    with pytest.raises(CommandError, match="--org"):
        run(monkeypatch, "--username", "owner")
    run(monkeypatch, "--username", "owner", "--org", "b")
    assert User.objects.get().organization == Organization.objects.get(slug="b")


def test_without_a_terminal_it_will_not_guess_the_password(monkeypatch, org):
    monkeypatch.setattr("sys.stdin", io.StringIO(""))
    with pytest.raises(CommandError, match="--password-stdin"):
        call_command("create_admin", "--username", "owner")


def test_prompt_asks_twice_and_the_two_must_match(monkeypatch, org):
    class Tty(io.StringIO):
        def isatty(self):
            return True

    monkeypatch.setattr("sys.stdin", Tty())
    answers = iter([GOOD, "different"])
    monkeypatch.setattr("getpass.getpass", lambda prompt="": next(answers))
    with pytest.raises(CommandError, match="differ"):
        call_command("create_admin", "--username", "owner")
    answers = iter([GOOD, GOOD])
    call_command("create_admin", "--username", "owner", stdout=io.StringIO())
    assert User.objects.get().check_password(GOOD)
