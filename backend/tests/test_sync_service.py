import pytest

from models.account import Account
from models.match import ManagedAlbum
from services import sync_service


def account(account_id: str) -> Account:
    return Account(
        id=account_id,
        name=account_id,
        immich_url=f"http://192.168.1.{len(account_id) + 10}",
        api_key="key",
        color="#000",
        user_id=f"user-{account_id}",
    )


@pytest.mark.asyncio
async def test_name_sync_records_previous_name(monkeypatch):
    class Client:
        def __init__(self, *_):
            pass

        async def get_person(self, _person_id):
            return {"name": "Before"}

        async def update_person(self, _person_id, payload):
            assert payload == {"name": "After"}
            return {"name": "After"}

    monkeypatch.setattr(sync_service, "ImmichClient", Client)
    entries = await sync_service.sync_names(account("a"), "p1", account("b"), "p2", "After")
    assert all(entry.undo_data["previous_name"] == "Before" for entry in entries)


@pytest.mark.asyncio
async def test_album_is_shared_only_with_participants(monkeypatch):
    owner, participant, unrelated = account("owner"), account("participant"), account("unrelated")
    captured = []

    class Client:
        def __init__(self, *_):
            pass

        async def get_person_assets(self, _person_id):
            return []

        async def create_album(self, _name, _assets):
            return {"id": "album"}

    async def fake_share(_client, _album_id, _album_name, accounts):
        captured.extend(a.id for a in accounts)
        return []

    class Store:
        def add_managed_album(self, _album):
            pass

    monkeypatch.setattr(sync_service, "ImmichClient", Client)
    monkeypatch.setattr(sync_service, "_share_album_if_needed", fake_share)
    refs = [
        {"account_id": "owner", "person_id": "p1"},
        {"account_id": "participant", "person_id": "p2"},
    ]
    await sync_service.create_shared_album(
        "match", owner, [owner, participant, unrelated], refs, "Album", Store()
    )
    assert captured == ["participant"]


@pytest.mark.asyncio
async def test_album_sharing_deduplicates_accounts_and_immich_users():
    shared_entries: list[dict] = []

    class Client:
        async def get_album_user_ids(self, _album_id):
            return set()

        async def share_album_with_users(self, _album_id, entries):
            shared_entries.extend(entries)

    first = account("first")
    alias = account("alias")
    alias.user_id = first.user_id

    await sync_service._share_album_if_needed(
        Client(), "album", "Family", [first, first, alias]
    )

    assert shared_entries == [{"userId": first.user_id, "role": "editor"}]


@pytest.mark.asyncio
async def test_conditional_album_with_three_people_includes_assets_seen_for_at_least_two(monkeypatch):
    created_assets: list[str] = []
    saved: list[ManagedAlbum] = []
    assets_by_person = {
        "p1": ["together-12", "together-123", "only-1"],
        "p2": ["together-12", "together-123", "only-2"],
        "p3": ["together-123", "only-3"],
    }

    class Client:
        def __init__(self, *_):
            pass

        async def get_person_assets(self, person_id):
            return [{"id": asset_id} for asset_id in assets_by_person[person_id]]

        async def create_album(self, _name, asset_ids):
            created_assets.extend(asset_ids)
            return {"id": "album"}

    async def skip_sharing(*_args):
        return []

    class Store:
        def add_managed_album(self, album):
            saved.append(album)

    owner = account("owner")
    refs = [
        {"account_id": owner.id, "person_id": "p1"},
        {"account_id": owner.id, "person_id": "p2"},
        {"account_id": owner.id, "person_id": "p3"},
    ]
    monkeypatch.setattr(sync_service, "ImmichClient", Client)
    monkeypatch.setattr(sync_service, "_share_album_if_needed", skip_sharing)

    managed, _ = await sync_service.create_shared_album(
        "conditional", owner, [owner], refs, "Family", Store(), minimum_person_count=2
    )

    assert created_assets == ["together-12", "together-123"]
    assert managed is saved[0]
    assert managed.minimum_person_count == 2
    assert managed.total_assets == 2


@pytest.mark.asyncio
async def test_conditional_album_does_not_create_empty_album_when_person_search_fails(monkeypatch):
    create_calls: list[str] = []

    class Client:
        def __init__(self, *_):
            pass

        async def get_person_assets(self, person_id):
            if person_id == "p2":
                raise RuntimeError("search failed")
            return [{"id": "asset-1"}]

        async def create_album(self, name, _asset_ids):
            create_calls.append(name)
            return {"id": "album"}

    class Store:
        def add_managed_album(self, _album):
            raise AssertionError("failed conditional album must not be persisted")

    owner = account("owner")
    refs = [
        {"account_id": owner.id, "person_id": "p1"},
        {"account_id": owner.id, "person_id": "p2"},
    ]
    monkeypatch.setattr(sync_service, "ImmichClient", Client)

    managed, logs = await sync_service.create_shared_album(
        "conditional", owner, [owner], refs, "Family", Store(), minimum_person_count=2
    )

    assert managed is None
    assert create_calls == []
    assert len(logs) == 1
    assert logs[0].status == "error"
    assert logs[0].message_key == "log_album_create_failed"


@pytest.mark.asyncio
async def test_conditional_album_refresh_reapplies_threshold(monkeypatch):
    add_calls: list[list[str]] = []
    assets_by_person = {
        "p1": ["existing", "new-shared", "only-1"],
        "p2": ["new-shared"],
        "p3": ["existing"],
    }

    class Client:
        def __init__(self, *_):
            pass

        async def get_album_assets(self, _album_id):
            return ["existing"]

        async def get_person_assets(self, person_id):
            return [{"id": asset_id} for asset_id in assets_by_person[person_id]]

        async def add_assets_to_album(self, _album_id, asset_ids):
            add_calls.append(asset_ids)
            return [{"id": asset_id, "success": True} for asset_id in asset_ids]

    async def skip_sharing(*_args):
        return []

    class Store:
        def update_managed_album(self, _album):
            pass

    owner = account("owner")
    managed = ManagedAlbum(
        id="managed-conditional",
        match_id="conditional",
        album_id="album",
        album_name="Family",
        owner_account_id=owner.id,
        person_refs=[
            {"account_id": owner.id, "person_id": "p1"},
            {"account_id": owner.id, "person_id": "p2"},
            {"account_id": owner.id, "person_id": "p3"},
        ],
        minimum_person_count=2,
        created_at="2026-08-02T00:00:00+00:00",
    )
    monkeypatch.setattr(sync_service, "ImmichClient", Client)
    monkeypatch.setattr(sync_service, "_share_album_if_needed", skip_sharing)

    await sync_service.refresh_managed_album(managed, [owner], Store())

    assert add_calls == [["new-shared"]]
    assert managed.total_assets == 2


@pytest.mark.asyncio
async def test_existing_album_applies_threshold_per_account(monkeypatch):
    add_calls: list[list[str]] = []
    assets = {
        "a1": ["a-both", "a-only"], "a2": ["a-both"],
        "b1": ["b-both"], "b2": ["b-both", "b-only"],
    }

    class Client:
        def __init__(self, *_): pass
        async def get_album_user_ids(self, _album_id): return set()
        async def share_album_with_users(self, *_args): return {}
        async def get_album_assets(self, _album_id): return []
        async def get_person_assets(self, person_id):
            return [{"id": item} for item in assets[person_id]]
        async def add_assets_to_album(self, _album_id, asset_ids):
            add_calls.append(asset_ids)
            return [{"id": item, "success": True} for item in asset_ids]

    class Store:
        def add_managed_album(self, album): self.album = album

    owner, other = account("owner"), account("other")
    monkeypatch.setattr(sync_service, "ImmichClient", Client)
    managed, _ = await sync_service.link_existing_album(
        "conditional", owner, "album", "Family", [owner, other], [
            {"account_id": owner.id, "person_id": "a1"},
            {"account_id": owner.id, "person_id": "a2"},
            {"account_id": other.id, "person_id": "b1"},
            {"account_id": other.id, "person_id": "b2"},
        ], Store(), minimum_person_count=2,
        linked_person_ids=["l1", "l2"], condition_person_count=2,
    )
    assert add_calls == [["a-both"], ["b-both"]]
    assert managed.minimum_person_count == 2
    assert managed.linked_person_ids == ["l1", "l2"]
    assert managed.condition_person_count == 2


def test_legacy_managed_album_derives_condition_person_count():
    managed = ManagedAlbum(
        id="legacy", match_id="match", album_id="album", album_name="Legacy",
        owner_account_id="owner", person_refs=[
            {"account_id": "owner", "person_id": "p1"},
            {"account_id": "owner", "person_id": "p2"},
        ], created_at="2026-01-01T00:00:00+00:00",
    )
    assert managed.condition_person_count == 2


@pytest.mark.asyncio
async def test_refresh_does_not_readd_assets_already_in_the_album(monkeypatch):
    add_calls: list[list[str]] = []

    class Client:
        def __init__(self, *_):
            pass

        async def get_album_assets(self, _album_id):
            return ["asset-1"]

        async def get_person_assets(self, _person_id):
            return [{"id": "asset-1"}]

        async def add_assets_to_album(self, _album_id, asset_ids):
            add_calls.append(asset_ids)

    async def skip_sharing(*_args):
        return []

    class Store:
        def update_managed_album(self, _album):
            pass

    owner = account("owner")
    managed = ManagedAlbum(
        id="managed-1",
        match_id="match-1",
        album_id="album-1",
        album_name="Family",
        owner_account_id=owner.id,
        person_refs=[{"account_id": owner.id, "person_id": "person-1"}],
        created_at="2026-08-02T00:00:00+00:00",
    )
    monkeypatch.setattr(sync_service, "ImmichClient", Client)
    monkeypatch.setattr(sync_service, "_share_album_if_needed", skip_sharing)

    entries = await sync_service.refresh_managed_album(managed, [owner], Store())

    assert add_calls == []
    assert managed.total_assets == 1
    assert entries[0].status == "success"


@pytest.mark.asyncio
async def test_refresh_adds_only_new_assets_and_updates_the_total(monkeypatch):
    add_calls: list[list[str]] = []

    class Client:
        def __init__(self, *_):
            pass

        async def get_album_assets(self, _album_id):
            return ["asset-1"]

        async def get_person_assets(self, _person_id):
            return [{"id": "asset-1"}, {"id": "asset-2"}]

        async def add_assets_to_album(self, _album_id, asset_ids):
            add_calls.append(asset_ids)
            return [{"id": asset_id, "success": True} for asset_id in asset_ids]

    async def skip_sharing(*_args):
        return []

    class Store:
        def update_managed_album(self, _album):
            pass

    owner = account("owner")
    managed = ManagedAlbum(
        id="managed-1",
        match_id="match-1",
        album_id="album-1",
        album_name="Family",
        owner_account_id=owner.id,
        person_refs=[{"account_id": owner.id, "person_id": "person-1"}],
        created_at="2026-08-02T00:00:00+00:00",
    )
    monkeypatch.setattr(sync_service, "ImmichClient", Client)
    monkeypatch.setattr(sync_service, "_share_album_if_needed", skip_sharing)

    entries = await sync_service.refresh_managed_album(managed, [owner], Store())

    assert add_calls == [["asset-2"]]
    assert managed.total_assets == 2
    assert entries[0].message_key == "log_assets_added_to_album"
    assert entries[0].message_params == {"count": 1, "account": owner.name, "album": managed.album_name}


@pytest.mark.asyncio
async def test_refresh_reports_partial_failures_and_ignores_duplicates(monkeypatch):
    class Client:
        def __init__(self, *_):
            pass

        async def get_album_assets(self, _album_id):
            return ["asset-1"]

        async def get_person_assets(self, _person_id):
            return [{"id": "asset-1"}, {"id": "asset-2"}, {"id": "asset-3"}, {"id": "asset-4"}]

        async def add_assets_to_album(self, _album_id, asset_ids):
            return [
                {"id": "asset-2", "success": True},
                {"id": "asset-3", "success": False, "error": "duplicate"},
                {"id": "asset-4", "success": False, "error": "permission"},
            ]

    async def skip_sharing(*_args):
        return []

    class Store:
        def update_managed_album(self, _album):
            pass

    owner = account("owner")
    managed = ManagedAlbum(
        id="managed-1",
        match_id="match-1",
        album_id="album-1",
        album_name="Family",
        owner_account_id=owner.id,
        person_refs=[{"account_id": owner.id, "person_id": "person-1"}],
        created_at="2026-08-02T00:00:00+00:00",
    )
    monkeypatch.setattr(sync_service, "ImmichClient", Client)
    monkeypatch.setattr(sync_service, "_share_album_if_needed", skip_sharing)

    entries = await sync_service.refresh_managed_album(managed, [owner], Store())

    # Only the real success counts toward the total.
    assert managed.total_assets == 2

    success_entries = [e for e in entries if e.status == "success"]
    failure_entries = [e for e in entries if e.status == "error"]

    assert len(success_entries) == 1
    assert success_entries[0].message_key == "log_assets_added_to_album"
    assert success_entries[0].message_params["count"] == 1

    # Exactly one failure entry — the duplicate is silently ignored.
    assert len(failure_entries) == 1
    assert failure_entries[0].message_key == "log_assets_partial_failure"
    assert failure_entries[0].message_params == {"count": 1, "account": owner.name}
    assert "1 Assets von 'owner' konnten nicht hinzugefügt werden" in failure_entries[0].details


@pytest.mark.asyncio
async def test_extend_match_adds_only_assets_missing_from_the_album(monkeypatch):
    add_calls: list[list[str]] = []

    class Client:
        def __init__(self, *_):
            pass

        async def get_person(self, _person_id):
            return {"id": "person-2", "name": "Family"}

        async def get_album_assets(self, _album_id):
            return ["asset-1"]

        async def get_person_assets(self, _person_id):
            return [{"id": "asset-1"}, {"id": "asset-2"}]

        async def add_assets_to_album(self, _album_id, asset_ids):
            add_calls.append(asset_ids)
            return [{"id": asset_id, "success": True} for asset_id in asset_ids]

    async def skip_sharing(*_args):
        return []

    class Store:
        def update_managed_album(self, _album):
            pass

    owner = account("owner")
    participant = account("participant")
    managed = ManagedAlbum(
        id="managed-1",
        match_id="match-1",
        album_id="album-1",
        album_name="Family",
        owner_account_id=owner.id,
        person_refs=[{"account_id": owner.id, "person_id": "person-1"}],
        created_at="2026-08-02T00:00:00+00:00",
        total_assets=1,
    )
    monkeypatch.setattr(sync_service, "ImmichClient", Client)
    monkeypatch.setattr(sync_service, "_share_album_if_needed", skip_sharing)

    await sync_service.extend_match(
        managed,
        participant,
        "person-2",
        "Family",
        None,
        [owner, participant],
        Store(),
    )

    assert add_calls == [["asset-2"]]
    assert managed.total_assets == 2
